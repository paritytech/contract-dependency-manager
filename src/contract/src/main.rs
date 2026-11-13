//! CDM ContractRegistry — implementation contract.
//!
//! Deployed behind `contract-eip1967-proxy`, which delegate-calls every
//! method here against the proxy's storage. Upgrades therefore keep the
//! registry's address: `setCode` points the proxy at a new implementation.
//!
//! The registry is also a factory: the first publish of a name instantiates
//! that name's shim (`contract-proxy`) at a deterministic CREATE2 address
//! (`salt = keccak256(name)`, the resolver address as constructor input).
//! Every publish, floor change, and freeze is then written to the resolver —
//! the one contract every shim asks how to route — keyed by shim address.
//! The registry is the resolver's admin and its only writer.
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
    use pvm_contract_sdk::{
        Address, CallFlags, HostApi, Lazy, Mapping, SolEncode, StorageVec, const_selector,
    };

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Published {
        /// Indexed (topic = keccak of the name): the SDK generates no `emit`
        /// for dynamic non-indexed fields.
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

    /// `init_target` was delegate-called against the name's proxy storage.
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

    /// The owner froze or unfroze the name's proxy.
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
        /// The resolver proxy: every shim is constructed with it and every
        /// routing change is written to it.
        resolver: Lazy<Address>,
        /// Code hash of the (pre-uploaded) per-name proxy blob.
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

        /// The address allowed to upgrade and freeze the registry.
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
            // A codeless target would brick the registry. MockHost cannot
            // seed code sizes; the e2e suite covers this guard.
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

        /// Per-name proxy blob for future first publishes; existing proxies
        /// keep their code.
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

        /// Set once: every shim bakes the resolver address into its CREATE2
        /// address, so it can never move afterwards.
        #[pvm_contract_sdk::method]
        pub fn set_resolver(&mut self, resolver: Address) -> Result<(), Error> {
            self.require_admin()?;
            if resolver == Address::ZERO {
                return Err(InvalidResolver.into());
            }
            if self.resolver.get() != Address::ZERO {
                return Err(ResolverAlreadySet.into());
            }
            self.resolver.set(&resolver);
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn get_resolver(&self) -> Address {
            self.resolver.get()
        }

        /// Point the resolver proxy at a new implementation: one upgrade
        /// reaches every name ever published. The resolver's errors bubble.
        #[pvm_contract_sdk::method]
        pub fn upgrade_resolver(&mut self, new_implementation: Address) -> Result<(), Error> {
            self.require_admin()?;
            self.call_resolver(RESOLVER_SET_CODE, &new_implementation)
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

        // ─── Publishing ──────────────────────────────────────────────────

        /// Publish `version_key` of `contract_name`. An unregistered name is
        /// claimed by its first publisher; afterwards only the owner may
        /// publish. The first publish instantiates the name's proxy; keys
        /// must strictly increase.
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

        /// `publish`, then the proxy delegate-calls `init_target` with
        /// `initialize(from, owner)` — `from` is the previously-latest key (0
        /// on a first publish). An initialization revert rolls back the
        /// whole publish.
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
            self.call_resolver(RESOLVER_PUBLISH, &(info.proxy, version_key, target))?;

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

        /// Raise the name's min-supported floor. Owner-only; monotonic and
        /// capped at the latest key by the resolver, whose errors bubble.
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

            self.call_resolver(RESOLVER_SET_MIN_SUPPORTED, &(info.proxy, version_key))?;
            MinSupportedSet {
                name: contract_name,
                version_key,
            }
            .emit(self.host());
            Ok(())
        }

        /// Freeze the name's proxy: plain and versioned calls revert
        /// `ContractFrozen()` until `unfreezeContract`; publish still works.
        /// Owner-only.
        #[pvm_contract_sdk::method]
        pub fn freeze_contract(&mut self, contract_name: String) -> Result<(), Error> {
            self.set_contract_frozen(contract_name, true)
        }

        #[pvm_contract_sdk::method]
        pub fn unfreeze_contract(&mut self, contract_name: String) -> Result<(), Error> {
            self.set_contract_frozen(contract_name, false)
        }

        // ─── Queries ─────────────────────────────────────────────────────

        /// The name's stable address (its proxy) as `(bool isSome, address)`.
        /// `cdm::import!` hardcodes this 64-byte layout.
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

        /// Alias of `getAddress`.
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

        /// CREATE2 with `salt = keccak256(name)` and the resolver as the one
        /// constructor argument: the address is a pure function of
        /// (registry, proxy blob, resolver address, name).
        fn instantiate_proxy(&mut self, contract_name: &String) -> Result<Address, Error> {
            let code_hash = self.proxy_code_hash.get();
            if code_hash == [0u8; 32] {
                return Err(ProxyCodeHashUnset.into());
            }
            let mut input = code_hash.to_vec();
            input.extend_from_slice(&encode(&self.resolver()?));
            let host = self.host();
            let mut salt = [0u8; 32];
            host.hash_keccak_256(contract_name.as_bytes(), &mut salt);

            let mut address = [0u8; 20];
            let result = host.instantiate(
                u64::MAX,
                u64::MAX,
                &[0xff; 32], // deposit bounded by the publisher's frame
                &[0u8; 32],  // zero value
                &input,
                Some(&mut address),
                None,
                Some(&salt),
            );
            if result.is_err() {
                self.bubble_revert();
            }
            Ok(Address(address))
        }

        /// `[MAGIC][0][callCode][init target word][initialize(from, owner)]`:
        /// the shim delegate-calls `init_target` with the trailing calldata.
        fn call_proxy_init(
            &mut self,
            proxy: &Address,
            init_target: &Address,
            from: u128,
            owner: &Address,
        ) {
            let mut calldata = meta_header(meta::CALL_CODE);
            calldata.extend_from_slice(&encode(init_target));
            calldata.extend_from_slice(&INITIALIZE_SELECTOR);
            calldata.extend_from_slice(&encode(&(from, *owner)));
            self.call(proxy, &calldata);
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

            self.call_resolver(RESOLVER_SET_FROZEN, &(info.proxy, frozen))?;
            ContractFrozenSet {
                name: contract_name,
                frozen,
            }
            .emit(self.host());
            Ok(())
        }

        fn resolver(&self) -> Result<Address, Error> {
            let resolver = self.resolver.get();
            if resolver == Address::ZERO {
                return Err(ResolverUnset.into());
            }
            Ok(resolver)
        }

        /// `selector(args)` on the resolver, bubbling its revert unchanged.
        fn call_resolver(&mut self, selector: [u8; 4], args: &impl SolEncode) -> Result<(), Error> {
            let resolver = self.resolver()?;
            let mut calldata = selector.to_vec();
            calldata.extend_from_slice(&encode(args));
            self.call(&resolver, &calldata);
            Ok(())
        }

        /// Call `callee`, bubbling its revert unchanged.
        fn call(&mut self, callee: &Address, calldata: &[u8]) {
            let host = self.host();
            let result = host.call_evm(
                CallFlags::empty(),
                &callee.0,
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
    }

    // ─── Wire helpers ─────────────────────────────────────────────────────

    const RESOLVER_PUBLISH: [u8; 4] = const_selector("publish(address,uint128,address)");
    const RESOLVER_SET_MIN_SUPPORTED: [u8; 4] = const_selector("setMinSupported(address,uint128)");
    const RESOLVER_SET_FROZEN: [u8; 4] = const_selector("setFrozen(address,bool)");
    const RESOLVER_SET_CODE: [u8; 4] = const_selector("setCode(address)");

    /// `[MAGIC][0][selector]`: a CDM meta call to a shim.
    fn meta_header(selector: [u8; 4]) -> Vec<u8> {
        let mut calldata = Vec::with_capacity(24 + 32 + 68);
        calldata.extend_from_slice(&MAGIC);
        calldata.extend_from_slice(&META_KEY.to_be_bytes());
        calldata.extend_from_slice(&selector);
        calldata
    }

    fn encode<T: SolEncode>(value: &T) -> Vec<u8> {
        let mut out = vec![0u8; value.encode_len()];
        value.encode_to(&mut out);
        out
    }
}

/// Method-level tests call typed methods on a `MockHost`; dispatch-level
/// tests drive `route()` with ABI calldata to lock the wire format.
#[cfg(test)]
mod tests {
    use super::contract_registry::{self, ContractRegistry};
    use super::types::{
        ContractEntry, ContractFrozen, ContractNameEmpty, ContractNameInvalid, ContractNameTooLong,
        ContractPage, InvalidInitTarget, InvalidResolver, InvalidVersionKey, OptionalAddress,
        OptionalString, OptionalVersionEntry, ProxyCodeHashUnset, ResolverAlreadySet,
        ResolverUnset, Unauthorized, UnauthorizedAdmin, VersionNotMonotonic,
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
    /// The resolver proxy the registry writes routing to.
    const RESOLVER: [u8; 20] = [0x5E; 20];
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

    /// Constructed by `caller` (the admin), instantiate mock staged, proxy
    /// code hash set, resolver unset.
    fn deployed_without_resolver(caller: [u8; 20]) -> (ContractRegistry, MockHost) {
        let mock = host_with_caller(caller);
        mock.mock_instantiate(PROXY, vec![]);
        let mut contract = registry(&mock);
        contract.new();
        contract.set_proxy_code_hash(PROXY_CODE_HASH).unwrap();
        (contract, mock)
    }

    /// `deployed_without_resolver` plus the resolver: ready to publish.
    fn deployed(caller: [u8; 20]) -> (ContractRegistry, MockHost) {
        let (mut contract, mock) = deployed_without_resolver(caller);
        contract.set_resolver(Address(RESOLVER)).unwrap();
        (contract, mock)
    }

    /// Same storage, different caller (MockHost fixes the caller at build).
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

    /// The exact calldata the registry must send the resolver.
    fn resolver_calldata(signature: &str, args: &[&[u8; 32]]) -> Vec<u8> {
        let mut data = const_selector(signature).to_vec();
        for arg in args {
            data.extend_from_slice(&arg[..]);
        }
        data
    }

    fn resolver_publish(key: u128, target: [u8; 20]) -> ([u8; 20], Vec<u8>) {
        (
            RESOLVER,
            resolver_calldata(
                "publish(address,uint128,address)",
                &[&word_addr(PROXY), &word_u128(key), &word_addr(target)],
            ),
        )
    }

    /// The exact callCode calldata a publish-with-initialization must send
    /// the shim: `[MAGIC][0][callCode][init word]` followed by
    /// `[initialize selector][from word][owner word]`, unpadded.
    fn init_calldata(init_target: [u8; 20], from: u128, owner: [u8; 20]) -> Vec<u8> {
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&META_KEY.to_be_bytes());
        data.extend_from_slice(&meta::CALL_CODE);
        data.extend_from_slice(&word_addr(init_target));
        data.extend_from_slice(&INITIALIZE_SELECTOR);
        data.extend_from_slice(&word_u128(from));
        data.extend_from_slice(&word_addr(owner));
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

        // The resolver was told about the version.
        assert_eq!(
            mock.take_recorded_calls(),
            vec![resolver_publish(V1_0_0, ADDR_1)]
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

        // Only the version registration went out — no second instantiation.
        assert_eq!(
            mock.take_recorded_calls(),
            vec![resolver_publish(V1_1_0, ADDR_2)]
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
        contract.set_resolver(Address(RESOLVER)).unwrap();

        assert_eq!(
            contract.publish(NAME.into(), V1_0_0, Address(ADDR_1), URI_1.into()),
            Err(ProxyCodeHashUnset.into())
        );
        assert_eq!(contract.get_contract_count(), 0);
    }

    #[test]
    fn publish_without_resolver_fails() {
        let (mut contract, _mock) = deployed_without_resolver(ALICE);
        assert_eq!(
            contract.publish(NAME.into(), V1_0_0, Address(ADDR_1), URI_1.into()),
            Err(ResolverUnset.into())
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

        // Name grammar is covered in contract-registry-core.
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
                resolver_publish(V1_0_0, ADDR_1),
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
                resolver_publish(V2_0_0, ADDR_2),
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
    fn set_min_supported_forwards_to_the_resolver_and_emits() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, V1_0_0, ADDR_1, URI_1);
        publish(&mut contract, NAME, V1_1_0, ADDR_2, URI_2);
        mock.take_recorded_calls();

        assert_eq!(contract.set_min_supported(NAME.into(), V1_1_0), Ok(()));
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(
                RESOLVER,
                resolver_calldata(
                    "setMinSupported(address,uint128)",
                    &[&word_addr(PROXY), &word_u128(V1_1_0)],
                ),
            )]
        );
        assert_eq!(
            mock.events().last(),
            Some(&(
                vec![
                    topic0("MinSupportedSet(string,uint128)"),
                    keccak256(NAME.as_bytes()),
                ],
                word_u128(V1_1_0).to_vec(),
            ))
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
        let set_frozen = |frozen: bool| {
            (
                RESOLVER,
                resolver_calldata(
                    "setFrozen(address,bool)",
                    &[&word_addr(PROXY), &word_bool(frozen)],
                ),
            )
        };
        assert_eq!(
            mock.take_recorded_calls(),
            vec![set_frozen(true), set_frozen(false)]
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
        // Every entry resolves to its proxy (all the same address under
        // MockHost's single global instantiate mock).
        let (mut contract, _mock) = deployed(ALICE);
        let v0_0_1 = pack_version(0, 0, 1);
        let v0_0_2 = pack_version(0, 0, 2);
        publish(&mut contract, "@cdm/alpha", v0_0_1, ADDR_1, "ipfs://alpha");
        publish(&mut contract, "@cdm/beta", v0_0_1, ADDR_1, "ipfs://beta-v0");
        publish(&mut contract, "@cdm/beta", v0_0_2, ADDR_2, "ipfs://beta-v1");
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
        for i in 0..101u32 {
            publish(
                &mut contract,
                &format!("@scope/pkg{i}"),
                V1_0_0,
                ADDR_1,
                URI_1,
            );
        }

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
        assert_eq!(contract.get_contract_count(), 1);
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

    // ─── Resolver ────────────────────────────────────────────────────────────

    #[test]
    fn set_resolver_is_admin_only_non_zero_and_write_once() {
        let (mut contract, mock) = deployed_without_resolver(ADMIN);
        assert_eq!(contract.get_resolver(), Address::ZERO);

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert_eq!(
            as_alice.set_resolver(Address(RESOLVER)),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(
            contract.set_resolver(Address::ZERO),
            Err(InvalidResolver.into())
        );

        assert_eq!(contract.set_resolver(Address(RESOLVER)), Ok(()));
        assert_eq!(contract.get_resolver(), Address(RESOLVER));
        assert_eq!(
            contract.set_resolver(Address(ADDR_1)),
            Err(ResolverAlreadySet.into())
        );
    }

    #[test]
    fn upgrade_resolver_forwards_set_code_to_the_resolver() {
        let (mut contract, mock) = deployed(ADMIN);
        assert_eq!(contract.upgrade_resolver(Address(NEW_IMPL)), Ok(()));
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(
                RESOLVER,
                resolver_calldata("setCode(address)", &[&word_addr(NEW_IMPL)]),
            )]
        );

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert_eq!(
            as_alice.upgrade_resolver(Address(NEW_IMPL)),
            Err(UnauthorizedAdmin.into())
        );
        let (mut unset, _) = deployed_without_resolver(ADMIN);
        assert_eq!(
            unset.upgrade_resolver(Address(NEW_IMPL)),
            Err(ResolverUnset.into())
        );
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
    // `pvm-cdm-macros` bakes the `getAddress(string)` selector into consumer
    // contracts and reads exactly 64 bytes back: bool at byte 31, address at
    // bytes 44..64.

    const OUT_LEN: usize = 4096;

    fn encode<T: SolEncode>(value: &T) -> Vec<u8> {
        let mut buf = vec![0u8; value.encode_len()];
        value.encode_to(&mut buf);
        buf
    }

    /// `getAddress(string)` calldata exactly as `cdm_lookup` emits it.
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

    // Multi-value returns are ONE tuple output (a leading offset word for
    // dynamic returns). Every deployed registry and released CLI decodes this
    // layout; bare Rust tuples would flatten it.
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
        let (mut contract, _mock) = deployed_without_resolver(ADMIN);
        let name = String::from(NAME);

        let cases: Vec<(&str, Vec<u8>)> = vec![
            ("setResolver(address)", encode(&Address(RESOLVER))),
            (
                "publish(string,uint128,address,string)",
                encode(&(name.clone(), V1_0_0, Address(ADDR_1), String::from(URI_1))),
            ),
            (
                // V2_0_0: must stay monotonic after the publish case above.
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
            ("getResolver()", vec![]),
            ("upgradeResolver(address)", encode(&Address(NEW_IMPL))),
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
