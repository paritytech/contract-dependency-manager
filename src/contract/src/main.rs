//! CDM ContractRegistry — implementation contract.
//!
//! Deployed behind `contract-registry-proxy` (EIP-1967), which delegate-calls
//! every method here against the proxy's storage. Upgrades therefore keep the
//! registry's address: `setCode` points the proxy at a new implementation.
//!
//! The registry is also a factory: the first publish of a name instantiates
//! that name's per-name proxy (`contract-proxy`) at a deterministic CREATE2
//! address (`salt = keccak256(name)`, empty constructor input), then every
//! version publish registers `(version key, implementation)` with it.
//!
//! The admin, implementation, and frozen flags live at fixed pseudo-random
//! slots (see `contract_registry_core::slots`) so future implementations can
//! reshape the ordinary storage fields without touching them.

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// The `#[contract]` macro injects `extern crate alloc` in on-chain and test
// builds, but not in the abi-gen pass, where `types` still needs it.
#[cfg(all(feature = "abi-gen", not(test)))]
extern crate alloc;

mod types;

// polkavm-linker defaults guest stacks to 8 KiB, which deep call chains
// overflow as a raw VM trap. Match resolc's production default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 262144)]
mod contract_registry {
    use super::types::*;
    use alloc::string::String;
    use alloc::vec;
    use alloc::vec::Vec;
    use contract_registry_core::MAX_PAGE_LIMIT;
    use contract_registry_core::naming::validate_contract_name;
    use contract_registry_core::slots::{ADMIN_SLOT, FROZEN_SLOT, IMPLEMENTATION_SLOT};
    use contract_registry_core::versioning::{
        INITIALIZE_SELECTOR, MAGIC, META_KEY, is_publishable_key, meta,
    };
    use pvm_contract_sdk::{Address, CallFlags, HostApi, Lazy, Mapping, StorageVec};

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Published {
        /// Indexed (so only its keccak hash lands in the topic): `emit` is
        /// not generated for events with dynamic non-indexed fields.
        #[indexed]
        pub name: String,
        pub version_key: u128,
        pub target: Address,
    }

    /// First publish of a name: its per-name proxy now owns its address.
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct ProxyCreated {
        #[indexed]
        pub name: String,
        pub proxy: Address,
    }

    /// A publish delivered its initialization: `init_target` was
    /// delegate-called against the name's proxy storage, exactly once.
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Initialized {
        #[indexed]
        pub name: String,
        pub version_key: u128,
        pub init_target: Address,
    }

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct MinSupportedSet {
        #[indexed]
        pub name: String,
        pub version_key: u128,
    }

    /// The owner froze or unfroze the name's proxy (all delegation halts
    /// while frozen — the pause switch for storage migrations).
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct ContractFrozenSet {
        #[indexed]
        pub name: String,
        pub frozen: bool,
    }

    /// EIP-1967 standard event, so proxy-aware tooling picks up upgrades.
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Upgraded {
        #[indexed]
        pub implementation: Address,
    }

    /// EIP-1967 standard event.
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct AdminChanged {
        pub previous_admin: Address,
        pub new_admin: Address,
    }

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct FrozenSet {
        pub frozen: bool,
    }

    pub struct ContractRegistry {
        /// Registered names in registration order; drives `getContracts` paging.
        names: StorageVec<String>,
        /// Name → owner, version count, per-name proxy.
        info: Mapping<String, NamedContractInfo>,
        /// name → version index → (packed semver key, implementation).
        versions: Mapping<String, Mapping<u32, VersionRecord>>,
        /// name → version index → metadata URI (Bulletin/IPFS).
        metadata_uri_of: Mapping<String, Mapping<u32, String>>,
        /// Mirror of each proxy's min-supported floor, for cheap reads.
        min_supported_of: Mapping<String, u128>,
        /// Code hash of the per-name proxy blob (pre-uploaded per chain);
        /// consumed by CREATE2 at first publish. Admin-settable.
        proxy_code_hash: Lazy<[u8; 32]>,
        /// Fixed-slot admin state, shared with the registry proxy.
        #[slot(raw = IMPLEMENTATION_SLOT)]
        implementation: Lazy<Address>,
        #[slot(raw = ADMIN_SLOT)]
        admin: Lazy<Address>,
        #[slot(raw = FROZEN_SLOT)]
        frozen: Lazy<bool>,
    }

    impl ContractRegistry {
        /// Runs only when the implementation itself is deployed. Through the
        /// proxy, admin is initialized by the proxy's constructor instead.
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            let deployer = self.caller();
            self.admin.set(&deployer);
        }

        // ─── Admin & longevity ───────────────────────────────────────────

        /// The address allowed to upgrade, freeze, and import registry state.
        #[pvm_contract_sdk::method]
        pub fn get_admin(&self) -> Address {
            self.admin.get()
        }

        /// Transfer admin permissions.
        #[pvm_contract_sdk::method]
        pub fn set_admin(&mut self, new_admin: Address) -> Result<(), Error> {
            self.require_admin()?;
            let previous_admin = self.admin.get();
            self.admin.set(&new_admin);
            AdminChanged {
                previous_admin,
                new_admin,
            }
            .emit(self.host());
            Ok(())
        }

        /// Upgrade in place: point the proxy at a new implementation while
        /// keeping the registry's address and state.
        #[pvm_contract_sdk::method]
        pub fn set_code(&mut self, new_implementation: Address) -> Result<(), Error> {
            self.require_admin()?;
            // A codeless target would brick the registry address forever.
            // On-chain only: MockHost has no way to seed code sizes, so the
            // guard is exercised by the e2e suite instead of unit tests.
            #[cfg(target_arch = "riscv64")]
            if self.host().code_size(&new_implementation.0) == 0 {
                return Err(BadImplementation.into());
            }
            self.implementation.set(&new_implementation);
            Upgraded {
                implementation: new_implementation,
            }
            .emit(self.host());
            Ok(())
        }

        /// The implementation the proxy currently delegates to.
        #[pvm_contract_sdk::method]
        pub fn get_code(&self) -> Address {
            self.implementation.get()
        }

        /// Code hash of the per-name proxy blob used for future first
        /// publishes. Existing proxies are unaffected — their code is fixed
        /// at instantiation forever.
        #[pvm_contract_sdk::method]
        pub fn set_proxy_code_hash(&mut self, code_hash: [u8; 32]) -> Result<(), Error> {
            self.require_admin()?;
            self.proxy_code_hash.set(&code_hash);
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn get_proxy_code_hash(&self) -> [u8; 32] {
            self.proxy_code_hash.get()
        }

        /// Freeze the registry: every state-changing call except the admin's
        /// fails with `ContractFrozen()` until `unfreeze`. Reads always work.
        #[pvm_contract_sdk::method]
        pub fn freeze(&mut self) -> Result<(), Error> {
            self.require_admin()?;
            self.frozen.set(&true);
            FrozenSet { frozen: true }.emit(self.host());
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn unfreeze(&mut self) -> Result<(), Error> {
            self.require_admin()?;
            self.frozen.set(&false);
            FrozenSet { frozen: false }.emit(self.host());
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn is_frozen(&self) -> bool {
            self.frozen.get()
        }

        /// Import existing registry data into a fresh registry deployment.
        /// Records state only — never instantiates proxies: pass the name's
        /// live proxy address, or zero for a legacy (v1-era) history.
        #[pvm_contract_sdk::method]
        pub fn admin_import_contracts(
            &mut self,
            contracts: Vec<ImportContract>,
        ) -> Result<(), Error> {
            self.require_admin()?;
            for contract in contracts {
                self.import_contract(contract)?;
            }
            Ok(())
        }

        // ─── Publishing ──────────────────────────────────────────────────

        /// Publish `version_key` of `contract_name`. The caller may publish
        /// if the name is unregistered (registering it, becoming its owner)
        /// or if they already own it. The first publish instantiates the
        /// name's proxy; every publish must use a strictly greater key than
        /// the last (legacy versions count as `0.0.(index + 1)`).
        #[pvm_contract_sdk::method]
        pub fn publish(
            &mut self,
            contract_name: String,
            version_key: u128,
            target: Address,
            metadata_uri: String,
        ) -> Result<(), Error> {
            self.publish_internal(contract_name, version_key, target, metadata_uri, None)
        }

        /// `publish` plus a one-shot initialization: once the version is
        /// recorded and the proxy repointed, the proxy delegate-calls
        /// `init_target` with `initialize(from, owner)` against its own storage
        /// — `from` is the previously-latest key (0 on a first publish),
        /// `owner` the name's owner. An initialization revert bubbles up and
        /// rolls back the entire publish.
        #[pvm_contract_sdk::method]
        pub fn publish_with_init(
            &mut self,
            contract_name: String,
            version_key: u128,
            target: Address,
            metadata_uri: String,
            init_target: Address,
        ) -> Result<(), Error> {
            if init_target == Address::ZERO {
                return Err(InvalidInitTarget.into());
            }
            self.publish_internal(
                contract_name,
                version_key,
                target,
                metadata_uri,
                Some(init_target),
            )
        }

        fn publish_internal(
            &mut self,
            contract_name: String,
            version_key: u128,
            target: Address,
            metadata_uri: String,
            init_target: Option<Address>,
        ) -> Result<(), Error> {
            self.require_unfrozen()?;
            validate_contract_name(&contract_name)?;
            if !is_publishable_key(version_key) {
                return Err(InvalidVersionKey.into());
            }

            let caller = self.caller();
            let mut info = self.info.get(&contract_name);
            let is_new_name = info.version_count == 0;
            if is_new_name {
                info.owner = caller;
            } else if info.owner != caller {
                return Err(Unauthorized.into());
            }

            // The latest key BEFORE this publish — the `from` an
            // initialization receives (0 on a first publish).
            let previous_latest = self.latest_key(&contract_name, &info).unwrap_or(0);
            if previous_latest != 0 && version_key <= previous_latest {
                return Err(VersionNotMonotonic {
                    attempted: version_key,
                    latest: previous_latest,
                }
                .into());
            }

            if info.proxy == Address::ZERO {
                let proxy = self.instantiate_proxy(&contract_name)?;
                info.proxy = proxy;
                ProxyCreated {
                    name: contract_name.clone(),
                    proxy,
                }
                .emit(self.host());
            }
            self.call_proxy_publish(&info.proxy, version_key, &target);

            let index = info.version_count;
            info.version_count = index.checked_add(1).ok_or(VersionOverflow)?;
            if is_new_name {
                self.names.push(&contract_name);
            }
            self.info.insert(&contract_name, &info);
            self.versions.entry(&contract_name).insert(
                &index,
                &VersionRecord {
                    version_key,
                    target,
                },
            );
            self.metadata_uri_of
                .entry(&contract_name)
                .insert(&index, &metadata_uri);

            Published {
                name: contract_name.clone(),
                version_key,
                target,
            }
            .emit(self.host());

            if let Some(init_target) = init_target {
                self.call_proxy_init(&info.proxy, &init_target, previous_latest, &info.owner);
                Initialized {
                    name: contract_name,
                    version_key,
                    init_target,
                }
                .emit(self.host());
            }
            Ok(())
        }

        /// Raise the name's minimum supported version: versioned calls below
        /// the floor revert `UnsupportedVersion` at the proxy. Owner-only,
        /// monotonic, capped at the latest published key (enforced by the
        /// proxy, whose errors bubble unchanged).
        #[pvm_contract_sdk::method]
        pub fn set_min_supported(
            &mut self,
            contract_name: String,
            version_key: u128,
        ) -> Result<(), Error> {
            self.require_unfrozen()?;
            let info = self.info.get(&contract_name);
            if info.version_count == 0 || info.owner != self.caller() {
                return Err(Unauthorized.into());
            }

            let mut calldata = meta_header(meta::SET_MIN_SUPPORTED);
            calldata.extend_from_slice(&word_u128(version_key));
            self.call_proxy(&info.proxy, &calldata);

            self.min_supported_of.insert(&contract_name, &version_key);
            MinSupportedSet {
                name: contract_name,
                version_key,
            }
            .emit(self.host());
            Ok(())
        }

        /// Freeze the name's proxy: every plain and versioned call reverts
        /// `ContractFrozen()` until `unfreezeContract`. Owner-only. The meta
        /// plane and registry operations (including publish) stay live, so
        /// the migration flow is freeze → publish → unfreeze → ratchet.
        #[pvm_contract_sdk::method]
        pub fn freeze_contract(&mut self, contract_name: String) -> Result<(), Error> {
            self.set_contract_frozen(contract_name, true)
        }

        #[pvm_contract_sdk::method]
        pub fn unfreeze_contract(&mut self, contract_name: String) -> Result<(), Error> {
            self.set_contract_frozen(contract_name, false)
        }

        // ─── Queries ─────────────────────────────────────────────────────

        /// The name's stable address — its per-name proxy — as an
        /// option-shaped `(bool isSome, address value)` tuple. This is the
        /// hot path used by `cdm::import!` runtime lookups — its 64-byte
        /// wire format is frozen.
        #[pvm_contract_sdk::method]
        pub fn get_address(&self, contract_name: String) -> OptionalAddress {
            let info = self.info.get(&contract_name);
            (info.version_count > 0).then_some(info.proxy).into()
        }

        /// Latest metadata URI for `contract_name`, option-shaped.
        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri(&self, contract_name: String) -> OptionalString {
            self.latest_index(&contract_name)
                .map(|index| self.metadata_uri_of.get(&contract_name).get(&index))
                .into()
        }

        /// The name's per-name proxy, option-shaped. Alias of `getAddress`,
        /// kept for tooling that asks the explicit question.
        #[pvm_contract_sdk::method]
        pub fn get_proxy(&self, contract_name: String) -> OptionalAddress {
            self.get_address(contract_name)
        }

        /// Latest published version key; zero for unregistered names.
        #[pvm_contract_sdk::method]
        pub fn get_latest_key(&self, contract_name: String) -> u128 {
            let info = self.info.get(&contract_name);
            self.latest_key(&contract_name, &info).unwrap_or(0)
        }

        /// The name's min-supported floor (registry mirror); zero = none.
        #[pvm_contract_sdk::method]
        pub fn get_min_supported(&self, contract_name: String) -> u128 {
            self.min_supported_of.get(&contract_name)
        }

        /// Version row by index: `(isSome, versionKey, target, metadataUri)`.
        #[pvm_contract_sdk::method]
        pub fn get_version_at(&self, contract_name: String, index: u32) -> OptionalVersionEntry {
            if !self.version_exists(&contract_name, index) {
                return OptionalVersionEntry {
                    is_some: false,
                    version_key: 0,
                    target: Address::ZERO,
                    metadata_uri: String::new(),
                };
            }
            let record = self.versions.get(&contract_name).get(&index);
            OptionalVersionEntry {
                is_some: true,
                version_key: record.version_key,
                target: record.target,
                metadata_uri: self.metadata_uri_of.get(&contract_name).get(&index),
            }
        }

        /// The contract name at a registration index; empty when out of range.
        #[pvm_contract_sdk::method]
        pub fn get_contract_name_at(&self, index: u32) -> String {
            self.names.try_get(index as u64).unwrap_or_default()
        }

        /// A page of latest contract entries by registration index.
        #[pvm_contract_sdk::method]
        pub fn get_contracts(&self, start: u32, count: u32) -> ContractPage {
            let total = self.names.len() as u32;
            let end = start.saturating_add(count.min(MAX_PAGE_LIMIT)).min(total);
            let mut entries = Vec::new();
            for index in start..end {
                if let Some(name) = self.names.try_get(index as u64) {
                    if let Some(entry) = self.latest_entry(name) {
                        entries.push(entry);
                    }
                }
            }
            ContractPage { total, entries }
        }

        #[pvm_contract_sdk::method]
        pub fn get_owner(&self, contract_name: String) -> Address {
            self.info.get(&contract_name).owner
        }

        #[pvm_contract_sdk::method]
        pub fn get_version_count(&self, contract_name: String) -> u32 {
            self.info.get(&contract_name).version_count
        }

        #[pvm_contract_sdk::method]
        pub fn get_contract_count(&self) -> u32 {
            self.names.len() as u32
        }

        // ─── Internals ───────────────────────────────────────────────────

        fn caller(&self) -> Address {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            Address(caller)
        }

        fn require_admin(&self) -> Result<(), Error> {
            if self.caller() != self.admin.get() {
                return Err(UnauthorizedAdmin.into());
            }
            Ok(())
        }

        /// Frozen blocks every mutation for everyone but the admin.
        fn require_unfrozen(&self) -> Result<(), Error> {
            if self.frozen.get() && self.caller() != self.admin.get() {
                return Err(ContractFrozen.into());
            }
            Ok(())
        }

        /// Latest published version index, `None` for unregistered names.
        fn latest_index(&self, contract_name: &String) -> Option<u32> {
            self.info.get(contract_name).version_count.checked_sub(1)
        }

        fn version_exists(&self, contract_name: &String, version: u32) -> bool {
            version < self.info.get(contract_name).version_count
        }

        fn latest_key(&self, contract_name: &String, info: &NamedContractInfo) -> Option<u128> {
            info.version_count
                .checked_sub(1)
                .map(|index| self.versions.get(contract_name).get(&index).version_key)
        }

        fn latest_entry(&self, name: String) -> Option<ContractEntry> {
            let info = self.info.get(&name);
            let index = info.version_count.checked_sub(1)?;
            Some(ContractEntry {
                version_key: self.versions.get(&name).get(&index).version_key,
                address: info.proxy,
                metadata_uri: self.metadata_uri_of.get(&name).get(&index),
                owner: info.owner,
                name,
            })
        }

        /// CREATE2-instantiate the name's proxy: `salt = keccak256(name)`,
        /// empty constructor input, so the address is a pure function of
        /// (registry, name, proxy blob) and predictable offline. The proxy's
        /// constructor pins its admin to the caller — this registry.
        fn instantiate_proxy(&mut self, contract_name: &String) -> Result<Address, Error> {
            let code_hash = self.proxy_code_hash.get();
            if code_hash == [0u8; 32] {
                return Err(ProxyCodeHashUnset.into());
            }
            let host = self.host();
            let mut salt = [0u8; 32];
            host.hash_keccak_256(contract_name.as_bytes(), &mut salt);

            let mut address = [0u8; 20];
            let result = host.instantiate(
                u64::MAX,
                u64::MAX,
                &[0xff; 32], // deposit bounded by the publisher's frame
                &[0u8; 32],  // zero value
                &code_hash,  // no constructor data follows the hash
                Some(&mut address),
                None,
                Some(&salt),
            );
            if result.is_err() {
                self.bubble_revert();
            }
            Ok(Address(address))
        }

        /// Register a version with the name's proxy over the CDM meta wire
        /// format (`[MAGIC][key=0][publish][key word][impl word]`).
        fn call_proxy_publish(&mut self, proxy: &Address, version_key: u128, target: &Address) {
            let mut calldata = meta_header(meta::PUBLISH);
            calldata.extend_from_slice(&word_u128(version_key));
            calldata.extend_from_slice(&word_address(target));
            self.call_proxy(proxy, &calldata);
        }

        /// Deliver an initialization into the name's proxy storage:
        /// `callCode(init_target, [initialize selector][from word][owner word])`
        /// over the meta wire format, canonical ABI `bytes` framing (offset
        /// 0x40, length, payload zero-padded to a word boundary).
        fn call_proxy_init(
            &mut self,
            proxy: &Address,
            init_target: &Address,
            from: u128,
            owner: &Address,
        ) {
            let mut inner = Vec::with_capacity(4 + 64);
            inner.extend_from_slice(&INITIALIZE_SELECTOR);
            inner.extend_from_slice(&word_u128(from));
            inner.extend_from_slice(&word_address(owner));
            let padded_len = inner.len().div_ceil(32) * 32;

            let mut calldata = meta_header(meta::CALL_CODE);
            calldata.extend_from_slice(&word_address(init_target));
            calldata.extend_from_slice(&word_usize(0x40));
            calldata.extend_from_slice(&word_usize(inner.len()));
            calldata.extend_from_slice(&inner);
            calldata.resize(calldata.len() + padded_len - inner.len(), 0);
            self.call_proxy(proxy, &calldata);
        }

        fn set_contract_frozen(
            &mut self,
            contract_name: String,
            frozen: bool,
        ) -> Result<(), Error> {
            self.require_unfrozen()?;
            let info = self.info.get(&contract_name);
            if info.version_count == 0 || info.owner != self.caller() {
                return Err(Unauthorized.into());
            }

            let selector = if frozen { meta::FREEZE } else { meta::UNFREEZE };
            let calldata = meta_header(selector);
            self.call_proxy(&info.proxy, &calldata);

            ContractFrozenSet {
                name: contract_name,
                frozen,
            }
            .emit(self.host());
            Ok(())
        }

        /// Call the proxy, bubbling its revert (e.g. `VersionNotMonotonic`,
        /// `MinAboveLatest`) unchanged so publishers see the precise error.
        fn call_proxy(&mut self, proxy: &Address, calldata: &[u8]) {
            let host = self.host();
            let result = host.call_evm(
                CallFlags::empty(),
                &proxy.0,
                u64::MAX,
                &[0u8; 32],
                calldata,
                None,
            );
            if result.is_err() {
                self.bubble_revert();
            }
        }

        /// Bubble the callee's revert payload unchanged. Diverges.
        fn bubble_revert(&self) -> ! {
            let host = self.host();
            let len = host.return_data_size() as usize;
            let mut data = vec![0u8; len];
            let mut data_ref: &mut [u8] = &mut data;
            host.return_data_copy(&mut data_ref, 0);
            host.revert(&data)
        }

        fn import_contract(&mut self, contract: ImportContract) -> Result<(), Error> {
            let contract_name = contract.contract_name;
            validate_contract_name(&contract_name)?;
            if contract.versions.is_empty() {
                return Err(ImportVersionsEmpty.into());
            }
            if self.info.get(&contract_name).version_count != 0 {
                return Err(ImportContractExists.into());
            }

            if contract.proxy == Address::ZERO {
                return Err(NoProxy.into());
            }

            let mut versions = self.versions.entry(&contract_name);
            let mut metadata_uris = self.metadata_uri_of.entry(&contract_name);
            let mut version_count: u32 = 0;
            let mut last_key: u128 = 0;
            for version in contract.versions {
                if !is_publishable_key(version.version_key) {
                    return Err(InvalidVersionKey.into());
                }
                if version.version_key <= last_key {
                    return Err(VersionNotMonotonic {
                        attempted: version.version_key,
                        latest: last_key,
                    }
                    .into());
                }
                last_key = version.version_key;
                versions.insert(
                    &version_count,
                    &VersionRecord {
                        version_key: version.version_key,
                        target: version.target,
                    },
                );
                metadata_uris.insert(&version_count, &version.metadata_uri);
                version_count = version_count.checked_add(1).ok_or(VersionOverflow)?;
            }

            self.names.push(&contract_name);
            self.info.insert(
                &contract_name,
                &NamedContractInfo {
                    owner: contract.owner,
                    version_count,
                    proxy: contract.proxy,
                },
            );
            Ok(())
        }
    }

    // ─── CDM meta wire helpers ────────────────────────────────────────────

    fn meta_header(selector: [u8; 4]) -> Vec<u8> {
        let mut calldata = Vec::with_capacity(24 + 64);
        calldata.extend_from_slice(&MAGIC);
        calldata.extend_from_slice(&META_KEY.to_be_bytes());
        calldata.extend_from_slice(&selector);
        calldata
    }

    fn word_u128(value: u128) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[16..].copy_from_slice(&value.to_be_bytes());
        word
    }

    fn word_usize(value: usize) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[24..].copy_from_slice(&(value as u64).to_be_bytes());
        word
    }

    fn word_address(address: &Address) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address.0);
        word
    }
}

/// Host-side unit tests for the ContractRegistry implementation.
///
/// Method-level tests call the typed methods directly on a `MockHost`-backed
/// contract; dispatch-level tests drive `route()` with ABI calldata to lock
/// the wire format — in particular the exact `getAddress(string)` layout the
/// `cdm::import!` macro (`pvm-cdm-macros`) hardcodes against, and the CDM
/// meta calldata the registry sends to per-name proxies.
#[cfg(test)]
mod tests {
    use super::contract_registry::{self, ContractRegistry};
    use super::types::{
        ContractEntry, ContractFrozen, ContractNameEmpty, ContractNameInvalid, ContractNameTooLong,
        ContractPage, ImportContract, ImportContractExists, ImportContractVersion,
        ImportVersionsEmpty, InvalidInitTarget, InvalidVersionKey, NoProxy, OptionalAddress,
        OptionalString, OptionalVersionEntry, ProxyCodeHashUnset, Unauthorized, UnauthorizedAdmin,
        VersionNotMonotonic,
    };
    use contract_registry_core::versioning::{
        INITIALIZE_SELECTOR, MAGIC, META_KEY, meta, pack_version,
    };
    use pvm_contract_sdk::{
        Address, MockHost, MockHostBuilder, OutSink, Outcome, SolEncode, const_selector, keccak256,
    };

    const ADMIN: [u8; 20] = [0xAD; 20];
    const ALICE: [u8; 20] = [0xAA; 20];
    const BOB: [u8; 20] = [0xB0; 20];
    const ADDR_1: [u8; 20] = [0x11; 20];
    const ADDR_2: [u8; 20] = [0x22; 20];
    const NEW_IMPL: [u8; 20] = [0x1C; 20];
    /// Where the mocked `instantiate` lands every per-name proxy (MockHost
    /// supports exactly one global instantiate address).
    const PROXY: [u8; 20] = [0x99; 20];
    const PROXY_CODE_HASH: [u8; 32] = [0xC4; 32];
    const NAME: &str = "@cdm/registry";
    const URI_1: &str = "ipfs://one";
    const URI_2: &str = "ipfs://two";

    const V1_0_0: u128 = pack_version(1, 0, 0);
    const V1_1_0: u128 = pack_version(1, 1, 0);
    const V2_0_0: u128 = pack_version(2, 0, 0);

    // ─── Helpers ─────────────────────────────────────────────────────────────

    fn host_with_caller(caller: [u8; 20]) -> MockHost {
        MockHostBuilder::new().caller(caller).build()
    }

    fn registry(mock: &MockHost) -> ContractRegistry {
        ContractRegistry::with_host(mock.clone())
    }

    /// Deploy: construct against a fresh host and run the constructor, so the
    /// deployer becomes admin. The instantiate mock is staged so first
    /// publishes can create proxies, and the proxy code hash is configured.
    fn deployed(caller: [u8; 20]) -> (ContractRegistry, MockHost) {
        let mock = host_with_caller(caller);
        mock.mock_instantiate(PROXY, vec![]);
        let mut contract = registry(&mock);
        contract.new();
        contract.set_proxy_code_hash(PROXY_CODE_HASH).unwrap();
        (contract, mock)
    }

    /// "Next transaction from another account": `MockHost` fixes the caller at
    /// build time, so rebuild the host with the new caller and carry the full
    /// storage across.
    fn fork_with_caller(mock: &MockHost, caller: [u8; 20]) -> (ContractRegistry, MockHost) {
        let next = host_with_caller(caller);
        next.mock_instantiate(PROXY, vec![]);
        for (key, value) in mock.storage_dump() {
            next.set_raw_storage(key, value);
        }
        (registry(&next), next)
    }

    fn publish(
        contract: &mut ContractRegistry,
        name: &str,
        key: u128,
        target: [u8; 20],
        uri: &str,
    ) {
        contract
            .publish(name.into(), key, Address(target), uri.into())
            .unwrap();
    }

    fn import(
        name: &str,
        owner: [u8; 20],
        proxy: [u8; 20],
        versions: &[(u128, [u8; 20], &str)],
    ) -> ImportContract {
        ImportContract {
            contract_name: name.into(),
            owner: Address(owner),
            proxy: Address(proxy),
            versions: versions
                .iter()
                .map(|(key, target, uri)| ImportContractVersion {
                    version_key: *key,
                    target: Address(*target),
                    metadata_uri: (*uri).into(),
                })
                .collect(),
        }
    }

    fn word_addr(address: [u8; 20]) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    fn word_u32(value: u32) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[28..].copy_from_slice(&value.to_be_bytes());
        word
    }

    fn word_u128(value: u128) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[16..].copy_from_slice(&value.to_be_bytes());
        word
    }

    fn word_bool(value: bool) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[31] = value as u8;
        word
    }

    fn topic0(signature: &str) -> [u8; 32] {
        keccak256(signature.as_bytes())
    }

    fn some_addr(address: [u8; 20]) -> OptionalAddress {
        OptionalAddress {
            is_some: true,
            value: Address(address),
        }
    }

    fn none_addr() -> OptionalAddress {
        OptionalAddress {
            is_some: false,
            value: Address::ZERO,
        }
    }

    fn some_uri(uri: &str) -> OptionalString {
        OptionalString {
            is_some: true,
            value: uri.into(),
        }
    }

    fn none_uri() -> OptionalString {
        OptionalString {
            is_some: false,
            value: String::new(),
        }
    }

    fn page(total: u32, entries: Vec<ContractEntry>) -> ContractPage {
        ContractPage { total, entries }
    }

    /// The exact meta calldata the registry must send a proxy.
    fn meta_calldata(selector: [u8; 4], args: &[&[u8; 32]]) -> Vec<u8> {
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&META_KEY.to_be_bytes());
        data.extend_from_slice(&selector);
        for arg in args {
            data.extend_from_slice(&arg[..]);
        }
        data
    }

    /// The exact callCode calldata a publish-with-initialization must send:
    /// `[MAGIC][0][callCode][init word][offset 0x40][len 68]` followed by
    /// `[initialize selector][from word][owner word]` zero-padded to 96 bytes.
    fn init_calldata(init_target: [u8; 20], from: u128, owner: [u8; 20]) -> Vec<u8> {
        let mut offset = [0u8; 32];
        offset[31] = 0x40;
        let mut len = [0u8; 32];
        len[31] = 68;
        let mut data = meta_calldata(meta::CALL_CODE, &[&word_addr(init_target), &offset, &len]);
        data.extend_from_slice(&INITIALIZE_SELECTOR);
        data.extend_from_slice(&word_u128(from));
        data.extend_from_slice(&word_addr(owner));
        data.extend_from_slice(&[0u8; 28]);
        data
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    #[test]
    fn constructor_sets_admin() {
        let mock = host_with_caller(ALICE);
        let mut contract = registry(&mock);
        contract.new();
        assert_eq!(contract.get_admin(), Address(ALICE));
    }

    // ─── Publishing ──────────────────────────────────────────────────────────

    #[test]
    fn first_publish_registers_name_and_creates_proxy() {
        let (mut contract, mock) = deployed(ALICE);

        assert_eq!(
            contract.publish(NAME.into(), V1_0_0, Address(ADDR_1), URI_1.into()),
            Ok(())
        );

        assert_eq!(contract.get_owner(NAME.into()), Address(ALICE));
        assert_eq!(contract.get_version_count(NAME.into()), 1);
        // The name's address is its proxy — not the implementation.
        assert_eq!(contract.get_address(NAME.into()), some_addr(PROXY));
        assert_eq!(contract.get_proxy(NAME.into()), some_addr(PROXY));
        assert_eq!(contract.get_latest_key(NAME.into()), V1_0_0);
        assert_eq!(contract.get_metadata_uri(NAME.into()), some_uri(URI_1));
        // The implementation is recorded per version.
        assert_eq!(
            contract.get_version_at(NAME.into(), 0).target,
            Address(ADDR_1)
        );
        assert_eq!(contract.get_contract_count(), 1);
        assert_eq!(contract.get_contract_name_at(0), NAME);

        // The proxy was told about the version over the meta wire format.
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(
                PROXY,
                meta_calldata(meta::PUBLISH, &[&word_u128(V1_0_0), &word_addr(ADDR_1)]),
            )]
        );
    }

    #[test]
    fn second_publish_keeps_address_and_bumps_latest() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);
        mock.take_recorded_calls();

        publish(&mut contract, NAME, V1_1_0, ADDR_2, URI_2);

        assert_eq!(contract.get_version_count(NAME.into()), 2);
        assert_eq!(
            contract.get_contract_count(),
            1,
            "same name, not a new entry"
        );

        // The stable address never moves; the latest key does.
        assert_eq!(contract.get_address(NAME.into()), some_addr(PROXY));
        assert_eq!(contract.get_latest_key(NAME.into()), V1_1_0);
        assert_eq!(contract.get_metadata_uri(NAME.into()), some_uri(URI_2));

        // Both versions are recorded with their keys and targets.
        assert_eq!(
            contract.get_version_at(NAME.into(), 0),
            OptionalVersionEntry {
                is_some: true,
                version_key: V1_0_0,
                target: Address(ADDR_1),
                metadata_uri: URI_1.into(),
            }
        );
        assert_eq!(
            contract.get_version_at(NAME.into(), 1),
            OptionalVersionEntry {
                is_some: true,
                version_key: V1_1_0,
                target: Address(ADDR_2),
                metadata_uri: URI_2.into(),
            }
        );
        // Beyond the count → none.
        assert_eq!(
            contract.get_version_at(NAME.into(), 2),
            OptionalVersionEntry {
                is_some: false,
                version_key: 0,
                target: Address::ZERO,
                metadata_uri: String::new(),
            }
        );

        // Only the version registration went to the proxy — no second
        // instantiation (a second ProxyCreated event would also fail the
        // event assertions in `publish_emits_events_per_version`).
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(
                PROXY,
                meta_calldata(meta::PUBLISH, &[&word_u128(V1_1_0), &word_addr(ADDR_2)]),
            )]
        );
    }

    #[test]
    fn publish_requires_strictly_increasing_keys() {
        let (mut contract, _mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_1_0, ADDR_1, URI_1);

        for key in [V1_1_0, V1_0_0] {
            assert_eq!(
                contract.publish(NAME.into(), key, Address(ADDR_2), URI_2.into()),
                Err(VersionNotMonotonic {
                    attempted: key,
                    latest: V1_1_0,
                }
                .into()),
                "{key:#x}"
            );
        }
        assert_eq!(contract.get_version_count(NAME.into()), 1);
    }

    #[test]
    fn publish_rejects_invalid_keys() {
        let (mut contract, _mock) = deployed(ALICE);

        for key in [0u128, 1u128 << 96, u128::MAX] {
            assert_eq!(
                contract.publish(NAME.into(), key, Address(ADDR_1), URI_1.into()),
                Err(InvalidVersionKey.into()),
                "{key:#x}"
            );
        }
        assert_eq!(contract.get_contract_count(), 0);
    }

    #[test]
    fn publish_without_proxy_code_hash_fails() {
        let mock = host_with_caller(ALICE);
        mock.mock_instantiate(PROXY, vec![]);
        let mut contract = registry(&mock);
        contract.new();

        assert_eq!(
            contract.publish(NAME.into(), V1_0_0, Address(ADDR_1), URI_1.into()),
            Err(ProxyCodeHashUnset.into())
        );
        assert_eq!(contract.get_contract_count(), 0);
    }

    #[test]
    fn publish_by_non_owner_is_unauthorized() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);

        let (mut as_bob, _) = fork_with_caller(&mock, BOB);
        assert_eq!(
            as_bob.publish(NAME.into(), V1_1_0, Address(ADDR_2), URI_2.into()),
            Err(Unauthorized.into())
        );

        // Nothing changed.
        assert_eq!(as_bob.get_version_count(NAME.into()), 1);
        assert_eq!(as_bob.get_address(NAME.into()), some_addr(PROXY));
        assert_eq!(as_bob.get_owner(NAME.into()), Address(ALICE));
    }

    #[test]
    fn publish_rejects_invalid_names() {
        let (mut contract, _mock) = deployed(ALICE);

        assert_eq!(
            contract.publish(String::new(), V1_0_0, Address(ADDR_1), URI_1.into()),
            Err(ContractNameEmpty.into())
        );

        let too_long = format!("@scope/{}", "a".repeat(64));
        assert_eq!(
            contract.publish(too_long, V1_0_0, Address(ADDR_1), URI_1.into()),
            Err(ContractNameTooLong.into())
        );

        // Exhaustive name-grammar coverage lives in contract-registry-core; one
        // case per rejection shape is enough here.
        for name in ["cdm/registry", "@cdm"] {
            assert_eq!(
                contract.publish(name.into(), V1_0_0, Address(ADDR_1), URI_1.into()),
                Err(ContractNameInvalid.into()),
                "{name}"
            );
        }

        assert_eq!(contract.get_contract_count(), 0);
    }

    // ─── publishWithInit ─────────────────────────────────────────────────────

    /// A stand-in initialization contract address.
    const INIT_1: [u8; 20] = [0x1B; 20];

    #[test]
    fn publish_with_init_first_publish_sends_from_zero_and_owner() {
        let (mut contract, mock) = deployed(ALICE);

        assert_eq!(
            contract.publish_with_init(
                NAME.into(),
                V1_0_0,
                Address(ADDR_1),
                URI_1.into(),
                Address(INIT_1),
            ),
            Ok(())
        );

        // Version registration first, then the initialization — exact bytes.
        assert_eq!(
            mock.take_recorded_calls(),
            vec![
                (
                    PROXY,
                    meta_calldata(meta::PUBLISH, &[&word_u128(V1_0_0), &word_addr(ADDR_1)]),
                ),
                // First publish: from = 0, owner = the TOFU owner (ALICE).
                (PROXY, init_calldata(INIT_1, 0, ALICE)),
            ]
        );

        // Registry state is the same as a plain publish.
        assert_eq!(contract.get_version_count(NAME.into()), 1);
        assert_eq!(contract.get_latest_key(NAME.into()), V1_0_0);

        // ProxyCreated, Published, then Initialized.
        let name_topic = keccak256(NAME.as_bytes());
        let events = mock.events();
        assert_eq!(events.len(), 3);
        assert_eq!(
            events[2],
            (
                vec![topic0("Initialized(string,uint128,address)"), name_topic,],
                [word_u128(V1_0_0), word_addr(INIT_1)].concat(),
            )
        );
    }

    #[test]
    fn publish_with_init_upgrade_sends_previous_latest_as_from() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);
        mock.take_recorded_calls();

        assert_eq!(
            contract.publish_with_init(
                NAME.into(),
                V2_0_0,
                Address(ADDR_2),
                URI_2.into(),
                Address(INIT_1),
            ),
            Ok(())
        );

        assert_eq!(
            mock.take_recorded_calls(),
            vec![
                (
                    PROXY,
                    meta_calldata(meta::PUBLISH, &[&word_u128(V2_0_0), &word_addr(ADDR_2)]),
                ),
                // Upgrade: from = the latest key BEFORE this publish.
                (PROXY, init_calldata(INIT_1, V1_0_0, ALICE)),
            ]
        );
        assert_eq!(contract.get_latest_key(NAME.into()), V2_0_0);
    }

    #[test]
    fn publish_with_init_rejects_zero_init_target() {
        let (mut contract, _mock) = deployed(ALICE);
        assert_eq!(
            contract.publish_with_init(
                NAME.into(),
                V1_0_0,
                Address(ADDR_1),
                URI_1.into(),
                Address::ZERO,
            ),
            Err(InvalidInitTarget.into())
        );
        assert_eq!(contract.get_contract_count(), 0);
    }

    #[test]
    fn publish_with_init_enforces_publish_rules() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_1_0, ADDR_1, URI_1);

        // Same monotonic gate as plain publish.
        assert_eq!(
            contract.publish_with_init(
                NAME.into(),
                V1_0_0,
                Address(ADDR_2),
                URI_2.into(),
                Address(INIT_1),
            ),
            Err(VersionNotMonotonic {
                attempted: V1_0_0,
                latest: V1_1_0,
            }
            .into())
        );

        // Same ownership gate.
        let (mut as_bob, _) = fork_with_caller(&mock, BOB);
        assert_eq!(
            as_bob.publish_with_init(
                NAME.into(),
                V2_0_0,
                Address(ADDR_2),
                URI_2.into(),
                Address(INIT_1),
            ),
            Err(Unauthorized.into())
        );
    }

    // ─── setMinSupported ─────────────────────────────────────────────────────

    #[test]
    fn set_min_supported_forwards_mirrors_and_emits() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);
        publish(&mut contract, NAME, V1_1_0, ADDR_2, URI_2);
        mock.take_recorded_calls();

        assert_eq!(contract.get_min_supported(NAME.into()), 0);
        assert_eq!(contract.set_min_supported(NAME.into(), V1_1_0), Ok(()));
        assert_eq!(contract.get_min_supported(NAME.into()), V1_1_0);

        // Forwarded to the proxy over the meta wire format.
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(
                PROXY,
                meta_calldata(meta::SET_MIN_SUPPORTED, &[&word_u128(V1_1_0)]),
            )]
        );
    }

    #[test]
    fn set_min_supported_requires_owner() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);

        // Not the owner (also covers unregistered names, which have no owner).
        let (mut as_bob, _) = fork_with_caller(&mock, BOB);
        assert_eq!(
            as_bob.set_min_supported(NAME.into(), V1_0_0),
            Err(Unauthorized.into())
        );
        assert_eq!(
            as_bob.set_min_supported("@cdm/missing".into(), V1_0_0),
            Err(Unauthorized.into())
        );
    }

    #[test]
    fn freeze_contract_forwards_and_requires_owner() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);
        mock.take_recorded_calls();

        assert_eq!(contract.freeze_contract(NAME.into()), Ok(()));
        assert_eq!(contract.unfreeze_contract(NAME.into()), Ok(()));
        assert_eq!(
            mock.take_recorded_calls(),
            vec![
                (PROXY, meta_calldata(meta::FREEZE, &[])),
                (PROXY, meta_calldata(meta::UNFREEZE, &[])),
            ]
        );

        let (mut as_bob, _) = fork_with_caller(&mock, BOB);
        assert_eq!(
            as_bob.freeze_contract(NAME.into()),
            Err(Unauthorized.into())
        );
        assert_eq!(
            as_bob.unfreeze_contract("@cdm/missing".into()),
            Err(Unauthorized.into())
        );
    }

    // ─── Queries on unregistered names ───────────────────────────────────────

    #[test]
    fn unregistered_name_queries_return_defaults() {
        let (contract, _mock) = deployed(ALICE);

        assert_eq!(contract.get_address(NAME.into()), none_addr());
        assert_eq!(contract.get_metadata_uri(NAME.into()), none_uri());
        assert_eq!(contract.get_proxy(NAME.into()), none_addr());
        assert_eq!(contract.get_latest_key(NAME.into()), 0);
        assert_eq!(contract.get_min_supported(NAME.into()), 0);
        assert!(!contract.get_version_at(NAME.into(), 0).is_some);
        assert_eq!(contract.get_owner(NAME.into()), Address::ZERO);
        assert_eq!(contract.get_version_count(NAME.into()), 0);
        assert_eq!(contract.get_contract_count(), 0);
        assert_eq!(contract.get_contract_name_at(0), "");
        assert_eq!(contract.get_contracts(0, 10), page(0, vec![]));
    }

    // ─── getContracts paging ─────────────────────────────────────────────────

    #[test]
    fn get_contracts_pages_latest_entries_by_registration_order() {
        // Two imported histories plus one live publish; every entry resolves
        // to its proxy (all the same address under MockHost's single global
        // instantiate mock).
        let (mut contract, _mock) = deployed(ALICE);
        contract
            .admin_import_contracts(vec![
                import(
                    "@cdm/alpha",
                    ALICE,
                    PROXY,
                    &[(pack_version(0, 0, 1), ADDR_1, "ipfs://alpha")],
                ),
                import(
                    "@cdm/beta",
                    ALICE,
                    PROXY,
                    &[
                        (pack_version(0, 0, 1), ADDR_1, "ipfs://beta-v0"),
                        (pack_version(0, 0, 2), ADDR_2, "ipfs://beta-v1"),
                    ],
                ),
            ])
            .unwrap();
        publish(&mut contract, "@cdm/gamma", V1_0_0, ADDR_2, "ipfs://gamma");

        let entry = |name: &str, key: u128, address: [u8; 20], uri: &str| ContractEntry {
            name: name.into(),
            version_key: key,
            address: Address(address),
            metadata_uri: uri.into(),
            owner: Address(ALICE),
        };

        let alpha = || entry("@cdm/alpha", pack_version(0, 0, 1), PROXY, "ipfs://alpha");
        let beta = || entry("@cdm/beta", pack_version(0, 0, 2), PROXY, "ipfs://beta-v1");
        let gamma = || entry("@cdm/gamma", V1_0_0, PROXY, "ipfs://gamma");

        // Full page: every entry carries its latest version.
        assert_eq!(
            contract.get_contracts(0, 10),
            page(3, vec![alpha(), beta(), gamma()])
        );
        // Partial pages.
        assert_eq!(contract.get_contracts(0, 2), page(3, vec![alpha(), beta()]));
        assert_eq!(contract.get_contracts(1, 1), page(3, vec![beta()]));
        assert_eq!(contract.get_contracts(2, 10), page(3, vec![gamma()]));
        // Start beyond the total → empty, total still reported.
        assert_eq!(contract.get_contracts(3, 5), page(3, vec![]));
        assert_eq!(contract.get_contracts(u32::MAX, 5), page(3, vec![]));
        // Zero count → empty.
        assert_eq!(contract.get_contracts(0, 0), page(3, vec![]));
    }

    #[test]
    fn get_contracts_clamps_count_to_max_page_limit() {
        let (mut contract, _mock) = deployed(ADMIN);
        let imports: Vec<ImportContract> = (0..101u32)
            .map(|i| {
                import(
                    &format!("@scope/pkg{i}"),
                    ALICE,
                    PROXY,
                    &[(pack_version(0, 0, 1), ADDR_1, URI_1)],
                )
            })
            .collect();
        contract.admin_import_contracts(imports).unwrap();

        // Count above MAX_PAGE_LIMIT clamps to 100 entries; total is unaffected.
        let head = contract.get_contracts(0, 200);
        assert_eq!(head.total, 101);
        assert_eq!(head.entries.len(), 100);
        assert_eq!(head.entries[0].name, "@scope/pkg0");
        assert_eq!(head.entries[99].name, "@scope/pkg99");

        let tail = contract.get_contracts(100, 200);
        assert_eq!(tail.total, 101);
        assert_eq!(tail.entries.len(), 1);
        assert_eq!(tail.entries[0].name, "@scope/pkg100");
    }

    // ─── adminImportContracts ────────────────────────────────────────────────

    #[test]
    fn admin_import_contracts_imports_multi_version_history() {
        let (mut contract, _mock) = deployed(ADMIN);

        let result = contract.admin_import_contracts(vec![
            import(
                "@cdm/alpha",
                ALICE,
                PROXY,
                &[
                    (pack_version(0, 0, 1), ADDR_1, "ipfs://a0"),
                    (pack_version(0, 0, 2), ADDR_2, "ipfs://a1"),
                ],
            ),
            import("@cdm/beta", BOB, PROXY, &[(V1_0_0, ADDR_2, "ipfs://b0")]),
        ]);
        assert_eq!(result, Ok(()));

        assert_eq!(contract.get_contract_count(), 2);
        assert_eq!(contract.get_contract_name_at(0), "@cdm/alpha");
        assert_eq!(contract.get_contract_name_at(1), "@cdm/beta");

        // Versions land in payload order; the latest resolves.
        assert_eq!(contract.get_version_count("@cdm/alpha".into()), 2);
        assert_eq!(contract.get_owner("@cdm/alpha".into()), Address(ALICE));
        assert_eq!(contract.get_address("@cdm/alpha".into()), some_addr(PROXY));
        let first = contract.get_version_at("@cdm/alpha".into(), 0);
        assert_eq!(first.version_key, pack_version(0, 0, 1));
        assert_eq!(first.target, Address(ADDR_1));
        assert_eq!(first.metadata_uri, "ipfs://a0");
        assert_eq!(
            contract.get_metadata_uri("@cdm/alpha".into()),
            some_uri("ipfs://a1")
        );

        // Every import resolves to its recorded proxy.
        assert_eq!(contract.get_version_count("@cdm/beta".into()), 1);
        assert_eq!(contract.get_owner("@cdm/beta".into()), Address(BOB));
        assert_eq!(contract.get_address("@cdm/beta".into()), some_addr(PROXY));
        assert_eq!(contract.get_proxy("@cdm/beta".into()), some_addr(PROXY));
    }

    #[test]
    fn imported_owner_can_publish_next_version() {
        let (mut contract, mock) = deployed(ADMIN);
        contract
            .admin_import_contracts(vec![import(
                "@cdm/alpha",
                ALICE,
                PROXY,
                &[(pack_version(0, 0, 1), ADDR_1, URI_1)],
            )])
            .unwrap();

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert_eq!(
            as_alice.publish("@cdm/alpha".into(), V1_0_0, Address(ADDR_2), URI_2.into()),
            Ok(())
        );
        assert_eq!(as_alice.get_version_count("@cdm/alpha".into()), 2);
        assert_eq!(as_alice.get_address("@cdm/alpha".into()), some_addr(PROXY));
    }

    #[test]
    fn admin_import_contracts_rejects_non_admin() {
        let (_contract, mock) = deployed(ADMIN);
        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);

        assert_eq!(
            as_alice.admin_import_contracts(vec![import(
                "@cdm/alpha",
                ALICE,
                PROXY,
                &[(pack_version(0, 0, 1), ADDR_1, URI_1)]
            )]),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(as_alice.get_contract_count(), 0);
    }

    #[test]
    fn admin_import_contracts_rejects_empty_versions() {
        let (mut contract, _mock) = deployed(ADMIN);

        assert_eq!(
            contract.admin_import_contracts(vec![import("@cdm/alpha", ALICE, PROXY, &[])]),
            Err(ImportVersionsEmpty.into())
        );
        assert_eq!(contract.get_contract_count(), 0);
    }

    #[test]
    fn admin_import_contracts_rejects_existing_name() {
        let (mut contract, _mock) = deployed(ADMIN);

        // Already published.
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);
        assert_eq!(
            contract.admin_import_contracts(vec![import(
                NAME,
                ALICE,
                PROXY,
                &[(V2_0_0, ADDR_2, URI_2)]
            )]),
            Err(ImportContractExists.into())
        );
        assert_eq!(contract.get_version_count(NAME.into()), 1);

        // Already imported.
        contract
            .admin_import_contracts(vec![import(
                "@cdm/alpha",
                ALICE,
                PROXY,
                &[(pack_version(0, 0, 1), ADDR_1, URI_1)],
            )])
            .unwrap();
        assert_eq!(
            contract.admin_import_contracts(vec![import(
                "@cdm/alpha",
                BOB,
                PROXY,
                &[(pack_version(0, 0, 2), ADDR_2, URI_2)]
            )]),
            Err(ImportContractExists.into())
        );
        assert_eq!(contract.get_owner("@cdm/alpha".into()), Address(ALICE));
    }

    #[test]
    fn admin_import_contracts_rejects_invalid_payloads() {
        let (mut contract, _mock) = deployed(ADMIN);

        assert_eq!(
            contract.admin_import_contracts(vec![import(
                "cdm/alpha",
                ALICE,
                PROXY,
                &[(pack_version(0, 0, 1), ADDR_1, URI_1)]
            )]),
            Err(ContractNameInvalid.into())
        );

        // Every name has a proxy; a zero proxy is not importable.
        assert_eq!(
            contract.admin_import_contracts(vec![import(
                "@cdm/alpha",
                ALICE,
                [0u8; 20],
                &[(pack_version(0, 0, 1), ADDR_1, URI_1)]
            )]),
            Err(NoProxy.into())
        );

        // Keys must be publishable and strictly increasing within an entry.
        assert_eq!(
            contract.admin_import_contracts(vec![import(
                "@cdm/alpha",
                ALICE,
                PROXY,
                &[(0, ADDR_1, URI_1)]
            )]),
            Err(InvalidVersionKey.into())
        );
        assert_eq!(
            contract.admin_import_contracts(vec![import(
                "@cdm/alpha",
                ALICE,
                PROXY,
                &[
                    (pack_version(0, 0, 2), ADDR_1, URI_1),
                    (pack_version(0, 0, 2), ADDR_2, URI_2),
                ]
            )]),
            Err(VersionNotMonotonic {
                attempted: pack_version(0, 0, 2),
                latest: pack_version(0, 0, 2),
            }
            .into())
        );
        assert_eq!(contract.get_contract_count(), 0);
    }

    // ─── setAdmin ────────────────────────────────────────────────────────────

    #[test]
    fn set_admin_transfers_admin_rights() {
        let (mut contract, mock) = deployed(ADMIN);

        assert_eq!(contract.set_admin(Address(BOB)), Ok(()));
        assert_eq!(contract.get_admin(), Address(BOB));
        assert_eq!(
            mock.events(),
            vec![(
                vec![topic0("AdminChanged(address,address)")],
                [word_addr(ADMIN), word_addr(BOB)].concat(),
            )]
        );

        // The old admin is just a regular account now.
        assert_eq!(contract.freeze(), Err(UnauthorizedAdmin.into()));
        assert_eq!(
            contract.set_admin(Address(ADMIN)),
            Err(UnauthorizedAdmin.into())
        );

        // The new admin holds the permissions.
        let (mut as_bob, _) = fork_with_caller(&mock, BOB);
        assert_eq!(as_bob.freeze(), Ok(()));
    }

    #[test]
    fn set_admin_rejects_non_admin() {
        let (_contract, mock) = deployed(ADMIN);
        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);

        assert_eq!(
            as_alice.set_admin(Address(ALICE)),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(as_alice.get_admin(), Address(ADMIN));
    }

    // ─── freeze / unfreeze ───────────────────────────────────────────────────

    #[test]
    fn freeze_and_unfreeze_require_admin() {
        let (_contract, mock) = deployed(ADMIN);
        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);

        assert_eq!(as_alice.freeze(), Err(UnauthorizedAdmin.into()));
        assert_eq!(as_alice.unfreeze(), Err(UnauthorizedAdmin.into()));
        assert!(!as_alice.is_frozen());
    }

    #[test]
    fn freeze_blocks_non_admin_mutations_but_not_reads() {
        let (mut contract, mock) = deployed(ADMIN);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);

        assert_eq!(contract.freeze(), Ok(()));
        assert!(contract.is_frozen());

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert!(as_alice.is_frozen());
        assert_eq!(
            as_alice.publish("@cdm/alice".into(), V1_0_0, Address(ADDR_2), URI_2.into()),
            Err(ContractFrozen.into())
        );

        // Reads keep working while frozen.
        assert_eq!(as_alice.get_address(NAME.into()), some_addr(PROXY));
        assert_eq!(as_alice.get_metadata_uri(NAME.into()), some_uri(URI_1));
        assert_eq!(as_alice.get_contract_count(), 1);
    }

    #[test]
    fn frozen_admin_is_exempt() {
        let (mut contract, _mock) = deployed(ADMIN);
        contract.freeze().unwrap();

        assert_eq!(
            contract.publish(NAME.into(), V1_0_0, Address(ADDR_1), URI_1.into()),
            Ok(())
        );
        assert_eq!(
            contract.admin_import_contracts(vec![import(
                "@cdm/alpha",
                ALICE,
                PROXY,
                &[(pack_version(0, 0, 1), ADDR_2, URI_2)]
            )]),
            Ok(())
        );
        assert_eq!(contract.get_contract_count(), 2);
    }

    #[test]
    fn unfreeze_restores_publishing() {
        let (mut contract, mock) = deployed(ADMIN);
        contract.freeze().unwrap();
        contract.unfreeze().unwrap();
        assert!(!contract.is_frozen());

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert_eq!(
            as_alice.publish(NAME.into(), V1_0_0, Address(ADDR_1), URI_1.into()),
            Ok(())
        );

        assert_eq!(
            mock.events(),
            vec![
                (vec![topic0("FrozenSet(bool)")], word_bool(true).to_vec()),
                (vec![topic0("FrozenSet(bool)")], word_bool(false).to_vec()),
            ]
        );
    }

    // ─── setCode ─────────────────────────────────────────────────────────────

    #[test]
    fn set_code_updates_implementation_and_emits_upgraded() {
        let (mut contract, mock) = deployed(ADMIN);

        assert_eq!(contract.set_code(Address(NEW_IMPL)), Ok(()));
        assert_eq!(contract.get_code(), Address(NEW_IMPL));
        assert_eq!(
            mock.events(),
            vec![(
                vec![topic0("Upgraded(address)"), word_addr(NEW_IMPL)],
                vec![],
            )]
        );
    }

    #[test]
    fn set_code_rejects_non_admin() {
        let (_contract, mock) = deployed(ADMIN);
        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);

        assert_eq!(
            as_alice.set_code(Address(NEW_IMPL)),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(as_alice.get_code(), Address::ZERO);
    }

    #[test]
    fn set_proxy_code_hash_requires_admin() {
        let (contract, mock) = deployed(ADMIN);
        assert_eq!(contract.get_proxy_code_hash(), PROXY_CODE_HASH);

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert_eq!(
            as_alice.set_proxy_code_hash([0x01; 32]),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(as_alice.get_proxy_code_hash(), PROXY_CODE_HASH);
    }

    // ─── Events ──────────────────────────────────────────────────────────────

    #[test]
    fn publish_emits_events_per_version() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);
        publish(&mut contract, NAME, V1_1_0, ADDR_2, URI_2);

        // Indexed string → the topic carries keccak256 of the name bytes.
        let name_topic = keccak256(NAME.as_bytes());
        assert_eq!(
            mock.events(),
            vec![
                (
                    vec![topic0("ProxyCreated(string,address)"), name_topic],
                    word_addr(PROXY).to_vec(),
                ),
                (
                    vec![topic0("Published(string,uint128,address)"), name_topic],
                    [word_u128(V1_0_0), word_addr(ADDR_1)].concat(),
                ),
                (
                    vec![topic0("Published(string,uint128,address)"), name_topic],
                    [word_u128(V1_1_0), word_addr(ADDR_2)].concat(),
                ),
            ]
        );
    }

    // ─── Dispatch-level ABI lock ─────────────────────────────────────────────
    //
    // `cdm::import!` (src/lib/cdm/rust-macros/pvm-cdm-macros/src/lib.rs) bakes
    // the `getAddress(string)` selector into consumer contracts and assumes the
    // return is exactly 64 bytes: word0 = bool at byte 31, word1 = address at
    // bytes 44..64. These tests pin that wire contract.

    /// Output buffer for `route()`; generous so dynamic returns always fit.
    const OUT_LEN: usize = 4096;

    fn encode<T: SolEncode>(value: &T) -> Vec<u8> {
        let mut buf = vec![0u8; value.encode_len()];
        value.encode_to(&mut buf);
        buf
    }

    /// Full `getAddress(string)` calldata with exactly the layout `cdm_lookup`
    /// emits: selector, 32-byte offset (0x20), 32-byte length, name bytes padded
    /// to a 32-byte boundary.
    fn cdm_lookup_calldata(name: &str) -> Vec<u8> {
        let name_len = name.len();
        let padded_len = name_len.div_ceil(32) * 32;
        let mut calldata = vec![0u8; 4 + 32 + 32 + padded_len];
        calldata[..4].copy_from_slice(&const_selector("getAddress(string)"));
        calldata[4 + 24..4 + 32].copy_from_slice(&32u64.to_be_bytes());
        calldata[4 + 32 + 24..4 + 32 + 32].copy_from_slice(&(name_len as u64).to_be_bytes());
        calldata[4 + 64..4 + 64 + name_len].copy_from_slice(name.as_bytes());
        calldata
    }

    /// Route full calldata (selector-prefixed) and return the encoded result.
    fn route_calldata(contract: &mut ContractRegistry, calldata: &[u8]) -> Vec<u8> {
        let mut selector = [0u8; 4];
        selector.copy_from_slice(&calldata[..4]);
        let mut buf = [0u8; OUT_LEN];
        let mut out: &mut [u8] = &mut buf;
        match contract_registry::route(contract, selector, &calldata[4..], &mut out) {
            Outcome::Return(len) => out.view(len).to_vec(),
            Outcome::Unhandled => panic!("selector {selector:02x?} did not match any method"),
        }
    }

    #[test]
    fn get_address_wire_format_matches_cdm_lookup_consumer() {
        let (mut contract, _mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);

        let calldata = cdm_lookup_calldata(NAME);
        assert_eq!(
            calldata[..4],
            [0xbf, 0x40, 0xfa, 0xc1],
            "keccak256(\"getAddress(string)\")[..4], hardcoded in pvm-cdm-macros"
        );

        let data = route_calldata(&mut contract, &calldata);
        assert_eq!(data.len(), 64, "cdm_lookup reads exactly 64 bytes");
        let mut expected = [0u8; 64];
        expected[31] = 1; // word0: bool isSome
        expected[44..].copy_from_slice(&PROXY); // word1: the stable proxy address
        assert_eq!(data, expected);
    }

    #[test]
    fn get_address_wire_format_for_missing_name_is_all_zero() {
        let (mut contract, _mock) = deployed(ALICE);

        let data = route_calldata(&mut contract, &cdm_lookup_calldata("@cdm/missing"));
        assert_eq!(data, [0u8; 64], "isSome byte 31 must be 0, address zeroed");
    }

    // The pre-proxy registry (old SDK line) encoded every multi-value return
    // as ONE tuple output, which for dynamic returns carries a leading offset
    // word. Every deployed registry and released CLI speaks that format, so
    // these tests freeze it byte-for-byte. Do not "simplify" the return
    // structs back to bare Rust tuples — that flattens the outputs and
    // silently changes these bytes.
    #[test]
    fn get_metadata_uri_wire_format_matches_legacy_tuple_encoding() {
        let (mut contract, _mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);

        let mut calldata = const_selector("getMetadataUri(string)").to_vec();
        calldata.extend_from_slice(&encode(&String::from(NAME)));
        let data = route_calldata(&mut contract, &calldata);

        let mut expected = Vec::new();
        expected.extend_from_slice(&word_u32(0x20)); // offset of the single tuple output
        expected.extend_from_slice(&word_bool(true)); // isSome
        expected.extend_from_slice(&word_u32(0x40)); // offset of `value` within the tuple
        expected.extend_from_slice(&word_u32(URI_1.len() as u32));
        let mut uri_word = [0u8; 32];
        uri_word[..URI_1.len()].copy_from_slice(URI_1.as_bytes());
        expected.extend_from_slice(&uri_word);
        assert_eq!(data, expected);
    }

    #[test]
    fn get_metadata_uri_wire_format_for_missing_name() {
        let (mut contract, _mock) = deployed(ALICE);

        let mut calldata = const_selector("getMetadataUri(string)").to_vec();
        calldata.extend_from_slice(&encode(&String::from(NAME)));
        let data = route_calldata(&mut contract, &calldata);

        let mut expected = Vec::new();
        expected.extend_from_slice(&word_u32(0x20));
        expected.extend_from_slice(&word_bool(false));
        expected.extend_from_slice(&word_u32(0x40));
        expected.extend_from_slice(&word_u32(0)); // empty string
        assert_eq!(data, expected);
    }

    #[test]
    fn get_contracts_wire_format_matches_legacy_tuple_encoding() {
        let (mut contract, _mock) = deployed(ALICE);

        let mut calldata = const_selector("getContracts(uint32,uint32)").to_vec();
        calldata.extend_from_slice(&encode(&(0u32, 10u32)));
        let data = route_calldata(&mut contract, &calldata);

        let mut expected = Vec::new();
        expected.extend_from_slice(&word_u32(0x20)); // offset of the single tuple output
        expected.extend_from_slice(&word_u32(0)); // total
        expected.extend_from_slice(&word_u32(0x40)); // offset of `entries` within the tuple
        expected.extend_from_slice(&word_u32(0)); // empty entries array
        assert_eq!(data, expected);
    }

    #[test]
    fn every_abi_selector_dispatches() {
        // Locks the camelCase ABI renames: each canonical signature must route to
        // a method (`Outcome::Return`), never fall through as `Unhandled`.
        let (mut contract, _mock) = deployed(ADMIN);
        let name = String::from(NAME);

        let cases: Vec<(&str, Vec<u8>)> = vec![
            (
                "publish(string,uint128,address,string)",
                encode(&(name.clone(), V1_0_0, Address(ADDR_1), String::from(URI_1))),
            ),
            (
                // V2_0_0: runs after the publish case above, so the key must
                // stay monotonic for the call to dispatch cleanly.
                "publishWithInit(string,uint128,address,string,address)",
                encode(&(
                    name.clone(),
                    V2_0_0,
                    Address(ADDR_2),
                    String::from(URI_2),
                    Address(INIT_1),
                )),
            ),
            (
                "setMinSupported(string,uint128)",
                encode(&(name.clone(), V1_0_0)),
            ),
            ("freezeContract(string)", encode(&name)),
            ("unfreezeContract(string)", encode(&name)),
            ("getAddress(string)", encode(&name)),
            ("getMetadataUri(string)", encode(&name)),
            ("getProxy(string)", encode(&name)),
            ("getLatestKey(string)", encode(&name)),
            ("getMinSupported(string)", encode(&name)),
            ("getVersionAt(string,uint32)", encode(&(name.clone(), 0u32))),
            ("getOwner(string)", encode(&name)),
            ("getVersionCount(string)", encode(&name)),
            ("getContractNameAt(uint32)", encode(&0u32)),
            ("getContracts(uint32,uint32)", encode(&(0u32, 10u32))),
            ("getContractCount()", vec![]),
            ("getAdmin()", vec![]),
            ("getCode()", vec![]),
            ("getProxyCodeHash()", vec![]),
            ("setProxyCodeHash(bytes32)", encode(&PROXY_CODE_HASH)),
            ("isFrozen()", vec![]),
            ("setAdmin(address)", encode(&Address(ADMIN))),
            ("setCode(address)", encode(&Address(NEW_IMPL))),
            ("freeze()", vec![]),
            ("unfreeze()", vec![]),
            (
                "adminImportContracts((string,address,address,(uint128,address,string)[])[])",
                encode(&vec![import(
                    "@cdm/imported",
                    ALICE,
                    PROXY,
                    &[(V2_0_0, ADDR_2, URI_2)],
                )]),
            ),
        ];

        for (signature, input) in cases {
            let mut buf = [0u8; OUT_LEN];
            let mut out: &mut [u8] = &mut buf;
            let outcome = contract_registry::route(
                &mut contract,
                const_selector(signature),
                &input,
                &mut out,
            );
            assert!(
                matches!(outcome, Outcome::Return(_)),
                "{signature} did not dispatch: {outcome:?}"
            );
        }

        // Control: an unknown selector stays unhandled.
        let mut buf = [0u8; OUT_LEN];
        let mut out: &mut [u8] = &mut buf;
        assert_eq!(
            contract_registry::route(&mut contract, [0xDE, 0xAD, 0xBE, 0xEF], &[], &mut out),
            Outcome::Unhandled
        );
    }
}
