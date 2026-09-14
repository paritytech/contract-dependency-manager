//! CDM ContractRegistry — implementation contract.
//!
//! Deployed behind `contract-registry-proxy` (EIP-1967), which delegate-calls
//! every method here against the proxy's storage. Upgrades therefore keep the
//! proxy's address: `setCode` points the proxy at a new implementation. The
//! admin, implementation, and frozen flags live at fixed pseudo-random slots
//! (see `contract_registry_core::slots`) so future implementations can
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
    use alloc::vec::Vec;
    use contract_registry_core::MAX_PAGE_LIMIT;
    use contract_registry_core::naming::validate_contract_name;
    use contract_registry_core::slots::{ADMIN_SLOT, FROZEN_SLOT, IMPLEMENTATION_SLOT};
    use pvm_contract_sdk::{Address, HostApi, Lazy, Mapping, StorageVec};

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Published {
        /// Indexed (so only its keccak hash lands in the topic): `emit` is
        /// not generated for events with dynamic non-indexed fields.
        #[indexed]
        pub name: String,
        pub version: u32,
        pub address: Address,
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
        /// Name → owner and published version count.
        info: Mapping<String, NamedContractInfo>,
        /// name → version → published contract address.
        address_of: Mapping<String, Mapping<u32, Address>>,
        /// name → version → metadata URI (Bulletin/IPFS).
        metadata_uri_of: Mapping<String, Mapping<u32, String>>,
        /// Fixed-slot admin state, shared with the proxy.
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

        /// Publish the next version of `contract_name`. The caller may
        /// publish if the name is unregistered (registering it, becoming its
        /// owner) or if they already own it.
        #[pvm_contract_sdk::method]
        pub fn publish_latest(
            &mut self,
            contract_name: String,
            contract_address: Address,
            metadata_uri: String,
        ) -> Result<(), Error> {
            self.require_unfrozen()?;
            validate_contract_name(&contract_name)?;

            let caller = self.caller();
            let mut info = self.info.get(&contract_name);
            if info.version_count == 0 {
                self.names.push(&contract_name);
                info.owner = caller;
            } else if info.owner != caller {
                return Err(Unauthorized.into());
            }

            let version = info.version_count;
            info.version_count = version.checked_add(1).ok_or(VersionOverflow)?;
            self.info.insert(&contract_name, &info);

            self.address_of
                .view_mut(&contract_name)
                .insert(&version, &contract_address);
            self.metadata_uri_of
                .view_mut(&contract_name)
                .insert(&version, &metadata_uri);

            Published {
                name: contract_name,
                version,
                address: contract_address,
            }
            .emit(self.host());
            Ok(())
        }

        // ─── Queries ─────────────────────────────────────────────────────

        /// Latest published address for `contract_name`, as an option-shaped
        /// `(bool isSome, address value)` tuple. This is the hot path used by
        /// `cdm::import!` runtime lookups.
        #[pvm_contract_sdk::method]
        pub fn get_address(&self, contract_name: String) -> OptionalAddress {
            self.latest_version(&contract_name)
                .map(|version| self.address_of.view(&contract_name).get(&version))
                .into()
        }

        /// Latest metadata URI for `contract_name`, option-shaped.
        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri(&self, contract_name: String) -> OptionalString {
            self.latest_version(&contract_name)
                .map(|version| self.metadata_uri_of.view(&contract_name).get(&version))
                .into()
        }

        #[pvm_contract_sdk::method]
        pub fn get_address_at_version(
            &self,
            contract_name: String,
            version: u32,
        ) -> OptionalAddress {
            self.version_exists(&contract_name, version)
                .then(|| self.address_of.view(&contract_name).get(&version))
                .into()
        }

        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri_at_version(
            &self,
            contract_name: String,
            version: u32,
        ) -> OptionalString {
            self.version_exists(&contract_name, version)
                .then(|| self.metadata_uri_of.view(&contract_name).get(&version))
                .into()
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
        fn latest_version(&self, contract_name: &String) -> Option<u32> {
            self.info.get(contract_name).version_count.checked_sub(1)
        }

        fn version_exists(&self, contract_name: &String, version: u32) -> bool {
            version < self.info.get(contract_name).version_count
        }

        fn latest_entry(&self, name: String) -> Option<ContractEntry> {
            let info = self.info.get(&name);
            let version = info.version_count.checked_sub(1)?;
            Some(ContractEntry {
                version,
                address: self.address_of.view(&name).get(&version),
                metadata_uri: self.metadata_uri_of.view(&name).get(&version),
                owner: info.owner,
                name,
            })
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

            let mut addresses = self.address_of.view_mut(&contract_name);
            let mut metadata_uris = self.metadata_uri_of.view_mut(&contract_name);
            let mut version_count: u32 = 0;
            for version in contract.versions {
                addresses.insert(&version_count, &version.address);
                metadata_uris.insert(&version_count, &version.metadata_uri);
                version_count = version_count.checked_add(1).ok_or(VersionOverflow)?;
            }

            self.names.push(&contract_name);
            self.info.insert(
                &contract_name,
                &NamedContractInfo {
                    owner: contract.owner,
                    version_count,
                },
            );
            Ok(())
        }
    }
}

/// Host-side unit tests for the ContractRegistry implementation.
///
/// Method-level tests call the typed methods directly on a `MockHost`-backed
/// contract; dispatch-level tests drive `route()` with ABI calldata to lock
/// the wire format — in particular the exact `getAddress(string)` layout the
/// `cdm::import!` macro (`pvm-cdm-macros`) hardcodes against.
#[cfg(test)]
mod tests {
    use super::contract_registry::{self, ContractRegistry};
    use super::types::{
        ContractEntry, ContractFrozen, ContractNameEmpty, ContractNameInvalid, ContractNameTooLong,
        ContractPage, ImportContract, ImportContractExists, ImportContractVersion,
        ImportVersionsEmpty, OptionalAddress, OptionalString, Unauthorized, UnauthorizedAdmin,
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
    const NAME: &str = "@cdm/registry";
    const URI_1: &str = "ipfs://one";
    const URI_2: &str = "ipfs://two";

    // ─── Helpers ─────────────────────────────────────────────────────────────

    fn host_with_caller(caller: [u8; 20]) -> MockHost {
        MockHostBuilder::new().caller(caller).build()
    }

    fn registry(mock: &MockHost) -> ContractRegistry {
        ContractRegistry::with_host(mock.clone())
    }

    /// Deploy: construct against a fresh host and run the constructor, so the
    /// deployer becomes admin.
    fn deployed(caller: [u8; 20]) -> (ContractRegistry, MockHost) {
        let mock = host_with_caller(caller);
        let mut contract = registry(&mock);
        contract.new();
        (contract, mock)
    }

    /// "Next transaction from another account": `MockHost` fixes the caller at
    /// build time, so rebuild the host with the new caller and carry the full
    /// storage across.
    fn fork_with_caller(mock: &MockHost, caller: [u8; 20]) -> (ContractRegistry, MockHost) {
        let next = host_with_caller(caller);
        for (key, value) in mock.storage_dump() {
            next.set_raw_storage(key, value);
        }
        (registry(&next), next)
    }

    fn publish(contract: &mut ContractRegistry, name: &str, address: [u8; 20], uri: &str) {
        contract
            .publish_latest(name.into(), Address(address), uri.into())
            .unwrap();
    }

    fn import(name: &str, owner: [u8; 20], versions: &[([u8; 20], &str)]) -> ImportContract {
        ImportContract {
            contract_name: name.into(),
            owner: Address(owner),
            versions: versions
                .iter()
                .map(|(address, uri)| ImportContractVersion {
                    address: Address(*address),
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
    fn publish_latest_registers_new_name() {
        let (mut contract, _mock) = deployed(ALICE);

        assert_eq!(
            contract.publish_latest(NAME.into(), Address(ADDR_1), URI_1.into()),
            Ok(())
        );

        assert_eq!(contract.get_owner(NAME.into()), Address(ALICE));
        assert_eq!(contract.get_version_count(NAME.into()), 1);
        assert_eq!(contract.get_address(NAME.into()), some_addr(ADDR_1));
        assert_eq!(contract.get_metadata_uri(NAME.into()), some_uri(URI_1));
        assert_eq!(contract.get_contract_count(), 1);
        assert_eq!(contract.get_contract_name_at(0), NAME);
    }

    #[test]
    fn second_publish_bumps_version_and_latest_resolves() {
        let (mut contract, _mock) = deployed(ALICE);
        publish(&mut contract, NAME, ADDR_1, URI_1);
        publish(&mut contract, NAME, ADDR_2, URI_2);

        assert_eq!(contract.get_version_count(NAME.into()), 2);
        assert_eq!(
            contract.get_contract_count(),
            1,
            "same name, not a new entry"
        );

        // Latest resolves to the second version.
        assert_eq!(contract.get_address(NAME.into()), some_addr(ADDR_2));
        assert_eq!(contract.get_metadata_uri(NAME.into()), some_uri(URI_2));

        // Both historical versions resolve.
        assert_eq!(
            contract.get_address_at_version(NAME.into(), 0),
            some_addr(ADDR_1)
        );
        assert_eq!(
            contract.get_address_at_version(NAME.into(), 1),
            some_addr(ADDR_2)
        );
        assert_eq!(
            contract.get_metadata_uri_at_version(NAME.into(), 0),
            some_uri(URI_1)
        );
        assert_eq!(
            contract.get_metadata_uri_at_version(NAME.into(), 1),
            some_uri(URI_2)
        );

        // Version beyond the count → (false, default).
        assert_eq!(contract.get_address_at_version(NAME.into(), 2), none_addr());
        assert_eq!(
            contract.get_metadata_uri_at_version(NAME.into(), u32::MAX),
            none_uri()
        );
    }

    #[test]
    fn publish_by_non_owner_is_unauthorized() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, ADDR_1, URI_1);

        let (mut as_bob, _) = fork_with_caller(&mock, BOB);
        assert_eq!(
            as_bob.publish_latest(NAME.into(), Address(ADDR_2), URI_2.into()),
            Err(Unauthorized.into())
        );

        // Nothing changed.
        assert_eq!(as_bob.get_version_count(NAME.into()), 1);
        assert_eq!(as_bob.get_address(NAME.into()), some_addr(ADDR_1));
        assert_eq!(as_bob.get_owner(NAME.into()), Address(ALICE));
    }

    #[test]
    fn publish_rejects_invalid_names() {
        let (mut contract, _mock) = deployed(ALICE);

        assert_eq!(
            contract.publish_latest(String::new(), Address(ADDR_1), URI_1.into()),
            Err(ContractNameEmpty.into())
        );

        let too_long = format!("@scope/{}", "a".repeat(64));
        assert_eq!(
            contract.publish_latest(too_long, Address(ADDR_1), URI_1.into()),
            Err(ContractNameTooLong.into())
        );

        // Exhaustive name-grammar coverage lives in contract-registry-core; one
        // case per rejection shape is enough here.
        for name in ["cdm/registry", "@cdm"] {
            assert_eq!(
                contract.publish_latest(name.into(), Address(ADDR_1), URI_1.into()),
                Err(ContractNameInvalid.into()),
                "{name}"
            );
        }

        assert_eq!(contract.get_contract_count(), 0);
    }

    // ─── Queries on unregistered names ───────────────────────────────────────

    #[test]
    fn unregistered_name_queries_return_defaults() {
        let (contract, _mock) = deployed(ALICE);

        assert_eq!(contract.get_address(NAME.into()), none_addr());
        assert_eq!(contract.get_metadata_uri(NAME.into()), none_uri());
        assert_eq!(contract.get_address_at_version(NAME.into(), 0), none_addr());
        assert_eq!(
            contract.get_metadata_uri_at_version(NAME.into(), 0),
            none_uri()
        );
        assert_eq!(contract.get_owner(NAME.into()), Address::ZERO);
        assert_eq!(contract.get_version_count(NAME.into()), 0);
        assert_eq!(contract.get_contract_count(), 0);
        assert_eq!(contract.get_contract_name_at(0), "");
        assert_eq!(contract.get_contracts(0, 10), page(0, vec![]));
    }

    // ─── getContracts paging ─────────────────────────────────────────────────

    #[test]
    fn get_contracts_pages_latest_entries_by_registration_order() {
        let (mut contract, _mock) = deployed(ALICE);
        publish(&mut contract, "@cdm/alpha", ADDR_1, "ipfs://alpha");
        publish(&mut contract, "@cdm/beta", ADDR_1, "ipfs://beta-v0");
        publish(&mut contract, "@cdm/beta", ADDR_2, "ipfs://beta-v1");
        publish(&mut contract, "@cdm/gamma", ADDR_2, "ipfs://gamma");

        let entry = |name: &str, version: u32, address: [u8; 20], uri: &str| ContractEntry {
            name: name.into(),
            version,
            address: Address(address),
            metadata_uri: uri.into(),
            owner: Address(ALICE),
        };
        let alpha = || entry("@cdm/alpha", 0, ADDR_1, "ipfs://alpha");
        let beta = || entry("@cdm/beta", 1, ADDR_2, "ipfs://beta-v1");
        let gamma = || entry("@cdm/gamma", 0, ADDR_2, "ipfs://gamma");

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
        let (mut contract, _mock) = deployed(ALICE);
        for i in 0..101u32 {
            publish(&mut contract, &format!("@scope/pkg{i}"), ADDR_1, URI_1);
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

    // ─── adminImportContracts ────────────────────────────────────────────────

    #[test]
    fn admin_import_contracts_imports_multi_version_history() {
        let (mut contract, _mock) = deployed(ADMIN);

        let result = contract.admin_import_contracts(vec![
            import(
                "@cdm/alpha",
                ALICE,
                &[(ADDR_1, "ipfs://a0"), (ADDR_2, "ipfs://a1")],
            ),
            import("@cdm/beta", BOB, &[(ADDR_2, "ipfs://b0")]),
        ]);
        assert_eq!(result, Ok(()));

        assert_eq!(contract.get_contract_count(), 2);
        assert_eq!(contract.get_contract_name_at(0), "@cdm/alpha");
        assert_eq!(contract.get_contract_name_at(1), "@cdm/beta");

        // Versions land in payload order; the latest resolves.
        assert_eq!(contract.get_version_count("@cdm/alpha".into()), 2);
        assert_eq!(contract.get_owner("@cdm/alpha".into()), Address(ALICE));
        assert_eq!(contract.get_address("@cdm/alpha".into()), some_addr(ADDR_2));
        assert_eq!(
            contract.get_address_at_version("@cdm/alpha".into(), 0),
            some_addr(ADDR_1)
        );
        assert_eq!(
            contract.get_metadata_uri_at_version("@cdm/alpha".into(), 0),
            some_uri("ipfs://a0")
        );
        assert_eq!(
            contract.get_metadata_uri("@cdm/alpha".into()),
            some_uri("ipfs://a1")
        );

        assert_eq!(contract.get_version_count("@cdm/beta".into()), 1);
        assert_eq!(contract.get_owner("@cdm/beta".into()), Address(BOB));
        assert_eq!(contract.get_address("@cdm/beta".into()), some_addr(ADDR_2));
    }

    #[test]
    fn imported_owner_can_publish_next_version() {
        let (mut contract, mock) = deployed(ADMIN);
        contract
            .admin_import_contracts(vec![import("@cdm/alpha", ALICE, &[(ADDR_1, URI_1)])])
            .unwrap();

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert_eq!(
            as_alice.publish_latest("@cdm/alpha".into(), Address(ADDR_2), URI_2.into()),
            Ok(())
        );
        assert_eq!(as_alice.get_version_count("@cdm/alpha".into()), 2);
        assert_eq!(as_alice.get_address("@cdm/alpha".into()), some_addr(ADDR_2));
    }

    #[test]
    fn admin_import_contracts_rejects_non_admin() {
        let (_contract, mock) = deployed(ADMIN);
        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);

        assert_eq!(
            as_alice.admin_import_contracts(vec![import("@cdm/alpha", ALICE, &[(ADDR_1, URI_1)])]),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(as_alice.get_contract_count(), 0);
    }

    #[test]
    fn admin_import_contracts_rejects_empty_versions() {
        let (mut contract, _mock) = deployed(ADMIN);

        assert_eq!(
            contract.admin_import_contracts(vec![import("@cdm/alpha", ALICE, &[])]),
            Err(ImportVersionsEmpty.into())
        );
        assert_eq!(contract.get_contract_count(), 0);
    }

    #[test]
    fn admin_import_contracts_rejects_existing_name() {
        let (mut contract, _mock) = deployed(ADMIN);

        // Already published.
        publish(&mut contract, NAME, ADDR_1, URI_1);
        assert_eq!(
            contract.admin_import_contracts(vec![import(NAME, ALICE, &[(ADDR_2, URI_2)])]),
            Err(ImportContractExists.into())
        );
        assert_eq!(contract.get_version_count(NAME.into()), 1);

        // Already imported.
        contract
            .admin_import_contracts(vec![import("@cdm/alpha", ALICE, &[(ADDR_1, URI_1)])])
            .unwrap();
        assert_eq!(
            contract.admin_import_contracts(vec![import("@cdm/alpha", BOB, &[(ADDR_2, URI_2)])]),
            Err(ImportContractExists.into())
        );
        assert_eq!(contract.get_owner("@cdm/alpha".into()), Address(ALICE));
    }

    #[test]
    fn admin_import_contracts_rejects_invalid_name() {
        let (mut contract, _mock) = deployed(ADMIN);

        assert_eq!(
            contract.admin_import_contracts(vec![import("cdm/alpha", ALICE, &[(ADDR_1, URI_1)])]),
            Err(ContractNameInvalid.into())
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
    fn freeze_blocks_non_admin_publishing_but_not_reads() {
        let (mut contract, mock) = deployed(ADMIN);
        publish(&mut contract, NAME, ADDR_1, URI_1);

        assert_eq!(contract.freeze(), Ok(()));
        assert!(contract.is_frozen());

        let (mut as_alice, _) = fork_with_caller(&mock, ALICE);
        assert!(as_alice.is_frozen());
        assert_eq!(
            as_alice.publish_latest("@cdm/alice".into(), Address(ADDR_2), URI_2.into()),
            Err(ContractFrozen.into())
        );

        // Reads keep working while frozen.
        assert_eq!(as_alice.get_address(NAME.into()), some_addr(ADDR_1));
        assert_eq!(as_alice.get_metadata_uri(NAME.into()), some_uri(URI_1));
        assert_eq!(as_alice.get_contract_count(), 1);
    }

    #[test]
    fn frozen_admin_is_exempt() {
        let (mut contract, _mock) = deployed(ADMIN);
        contract.freeze().unwrap();

        assert_eq!(
            contract.publish_latest(NAME.into(), Address(ADDR_1), URI_1.into()),
            Ok(())
        );
        assert_eq!(
            contract.admin_import_contracts(vec![import("@cdm/alpha", ALICE, &[(ADDR_2, URI_2)])]),
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
            as_alice.publish_latest(NAME.into(), Address(ADDR_1), URI_1.into()),
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

    // ─── Events ──────────────────────────────────────────────────────────────

    #[test]
    fn publish_emits_published_event_per_version() {
        let (mut contract, mock) = deployed(ALICE);
        publish(&mut contract, NAME, ADDR_1, URI_1);
        publish(&mut contract, NAME, ADDR_2, URI_2);

        // Indexed string → the topic carries keccak256 of the name bytes.
        let published = topic0("Published(string,uint32,address)");
        let name_topic = keccak256(NAME.as_bytes());
        assert_eq!(
            mock.events(),
            vec![
                (
                    vec![published, name_topic],
                    [word_u32(0), word_addr(ADDR_1)].concat(),
                ),
                (
                    vec![published, name_topic],
                    [word_u32(1), word_addr(ADDR_2)].concat(),
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
        publish(&mut contract, NAME, ADDR_1, URI_1);

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
        expected[44..].copy_from_slice(&ADDR_1); // word1: left-padded address
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
        publish(&mut contract, NAME, ADDR_1, URI_1);

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
                "publishLatest(string,address,string)",
                encode(&(name.clone(), Address(ADDR_1), String::from(URI_1))),
            ),
            ("getAddress(string)", encode(&name)),
            ("getMetadataUri(string)", encode(&name)),
            (
                "getAddressAtVersion(string,uint32)",
                encode(&(name.clone(), 0u32)),
            ),
            (
                "getMetadataUriAtVersion(string,uint32)",
                encode(&(name.clone(), 0u32)),
            ),
            ("getOwner(string)", encode(&name)),
            ("getVersionCount(string)", encode(&name)),
            ("getContractNameAt(uint32)", encode(&0u32)),
            ("getContracts(uint32,uint32)", encode(&(0u32, 10u32))),
            ("getContractCount()", vec![]),
            ("getAdmin()", vec![]),
            ("getCode()", vec![]),
            ("isFrozen()", vec![]),
            ("setAdmin(address)", encode(&Address(ADMIN))),
            ("setCode(address)", encode(&Address(NEW_IMPL))),
            ("freeze()", vec![]),
            ("unfreeze()", vec![]),
            (
                "adminImportContracts((string,address,(address,string)[])[])",
                encode(&vec![import("@cdm/imported", ALICE, &[(ADDR_2, URI_2)])]),
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
