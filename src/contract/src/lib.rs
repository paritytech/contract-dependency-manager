#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]
#![allow(dead_code, non_snake_case)]

#[cfg(all(
    not(target_arch = "riscv32"),
    not(target_arch = "riscv64"),
    not(feature = "abi-gen")
))]
extern crate std;

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 16384)]
mod contract_registry {
    use alloc::string::String;
    use alloc::vec::Vec;
    use pvm_contract_sdk::{Address, Lazy, Mapping, SolStorage, SolType};

    const MAX_CONTRACT_NAME_LEN: usize = 64;
    const MAX_PAGE_LIMIT: u32 = 100;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractNameEmpty;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractNameTooLong;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractNameInvalid;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractCountOverflow;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct Unauthorized;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct VersionOverflow;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub enum Error {
        ContractNameEmpty(ContractNameEmpty),
        ContractNameTooLong(ContractNameTooLong),
        ContractNameInvalid(ContractNameInvalid),
        ContractCountOverflow(ContractCountOverflow),
        Unauthorized(Unauthorized),
        VersionOverflow(VersionOverflow),
    }

    #[derive(Clone, SolType, SolStorage)]
    pub struct NamedContractInfo {
        pub owner: Address,
        pub version_count: u32,
    }

    #[derive(Clone, SolType)]
    pub struct ContractEntry {
        pub name: String,
        pub version: u32,
        pub address: Address,
        pub metadata_uri: String,
        pub owner: Address,
    }

    #[derive(Clone, Default, SolType)]
    pub struct ContractPage {
        pub total: u32,
        pub entries: Vec<ContractEntry>,
    }

    #[allow(non_snake_case)]
    #[derive(Clone, SolType)]
    pub struct OptionAddress {
        pub isSome: bool,
        pub value: Address,
    }

    #[allow(non_snake_case)]
    #[derive(Clone, SolType)]
    pub struct OptionString {
        pub isSome: bool,
        pub value: String,
    }

    pub struct ContractRegistry {
        contract_name_count: Lazy<u32>,
        contract_name_at: Mapping<u32, String>,
        published_address: Mapping<String, Mapping<u32, Address>>,
        published_metadata_uri: Mapping<String, Mapping<u32, String>>,
        info: Mapping<String, NamedContractInfo>,
    }

    impl ContractRegistry {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        /// Publish the latest version of a contract registered under `contract_name`.
        #[pvm_contract_sdk::method]
        pub fn publish_latest(
            &mut self,
            contract_name: String,
            contract_address: Address,
            metadata_uri: String,
        ) -> Result<(), Error> {
            validate_contract_name(&contract_name)?;

            let caller = self.caller();
            let mut info = match self.info.try_get(&contract_name) {
                Some(info) => info,
                None => {
                    let count = self.contract_name_count_u32();
                    let next_count = count.checked_add(1).ok_or(ContractCountOverflow)?;
                    self.contract_name_at.insert(&count, &contract_name);
                    self.contract_name_count.set(&next_count);
                    NamedContractInfo {
                        owner: caller,
                        version_count: 0,
                    }
                }
            };

            if info.owner != caller {
                return Err(Unauthorized.into());
            }

            info.version_count = info.version_count.checked_add(1).ok_or(VersionOverflow)?;
            self.info.insert(&contract_name, &info);

            let version_idx = info.version_count.saturating_sub(1);
            self.published_address
                .view_mut(&contract_name)
                .insert(&version_idx, &contract_address);
            self.published_metadata_uri
                .view_mut(&contract_name)
                .insert(&version_idx, &metadata_uri);

            Ok(())
        }

        /// Get the address of the latest published contract for a given name.
        #[pvm_contract_sdk::method]
        pub fn get_address(&self, contract_name: String) -> OptionAddress {
            match self.latest_version(&contract_name) {
                Some(version) => {
                    option_address(self.published_address.view(&contract_name).get(&version))
                }
                None => option_address_none(),
            }
        }

        /// Get the metadata URI of the latest published contract for a given name.
        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri(&self, contract_name: String) -> OptionString {
            match self.latest_version(&contract_name) {
                Some(version) => option_string(
                    self.published_metadata_uri
                        .view(&contract_name)
                        .get(&version),
                ),
                None => option_string_none(),
            }
        }

        /// Get the address of a specific version of a contract.
        #[pvm_contract_sdk::method]
        pub fn get_address_at_version(&self, contract_name: String, version: u32) -> OptionAddress {
            match self
                .published_address
                .view(&contract_name)
                .try_get(&version)
            {
                Some(address) => option_address(address),
                None => option_address_none(),
            }
        }

        /// Get the metadata URI of a specific version of a contract.
        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri_at_version(
            &self,
            contract_name: String,
            version: u32,
        ) -> OptionString {
            match self
                .published_metadata_uri
                .view(&contract_name)
                .try_get(&version)
            {
                Some(uri) => option_string(uri),
                None => option_string_none(),
            }
        }

        /// Get the contract name at a given append-only registry index.
        #[pvm_contract_sdk::method]
        pub fn get_contract_name_at(&self, index: u32) -> String {
            self.contract_name_at.get(&index)
        }

        /// Get a page of latest contract entries by append-only registry index.
        #[pvm_contract_sdk::method]
        pub fn get_contracts(&self, start: u32, count: u32) -> ContractPage {
            let total = self.contract_name_count_u32();
            let cap = if count > MAX_PAGE_LIMIT {
                MAX_PAGE_LIMIT
            } else {
                count
            };
            let mut entries: Vec<ContractEntry> = Vec::new();

            if total > 0 && start < total && cap > 0 {
                let mut scanned = 0u32;

                loop {
                    let index = start.saturating_add(scanned);
                    if scanned >= cap || index >= total {
                        break;
                    }

                    let name = self.contract_name_at.get(&index);
                    if let Some(entry) = self.latest_contract_entry(name) {
                        entries.push(entry);
                    }

                    scanned = scanned.saturating_add(1);
                }
            }

            ContractPage { total, entries }
        }

        /// Get the owner of a contract name.
        #[pvm_contract_sdk::method]
        pub fn get_owner(&self, contract_name: String) -> Address {
            self.info
                .try_get(&contract_name)
                .map(|i| i.owner)
                .unwrap_or(Address::ZERO)
        }

        /// Get the version count for a contract name.
        #[pvm_contract_sdk::method]
        pub fn get_version_count(&self, contract_name: String) -> u32 {
            self.info
                .try_get(&contract_name)
                .map(|i| i.version_count)
                .unwrap_or(0)
        }

        /// Get the number of contract names registered in the registry.
        #[pvm_contract_sdk::method]
        pub fn get_contract_count(&self) -> u32 {
            self.contract_name_count_u32()
        }

        fn caller(&self) -> Address {
            let mut bytes = [0u8; 20];
            self.host().caller(&mut bytes);
            Address(bytes)
        }

        fn latest_version(&self, contract_name: &String) -> Option<u32> {
            let info = self.info.try_get(contract_name)?;
            if info.version_count == 0 {
                None
            } else {
                Some(info.version_count.saturating_sub(1))
            }
        }

        fn latest_contract_entry(&self, contract_name: String) -> Option<ContractEntry> {
            let info = self.info.try_get(&contract_name)?;
            if info.version_count == 0 {
                return None;
            }

            let version = info.version_count.saturating_sub(1);
            let address = self
                .published_address
                .view(&contract_name)
                .try_get(&version)?;
            let metadata_uri = self
                .published_metadata_uri
                .view(&contract_name)
                .try_get(&version)?;

            Some(ContractEntry {
                name: contract_name,
                version,
                address,
                metadata_uri,
                owner: info.owner,
            })
        }

        fn contract_name_count_u32(&self) -> u32 {
            self.contract_name_count.get()
        }

        #[cfg(test)]
        pub(super) fn set_contract_name_count_for_test(&mut self, count: u32) {
            self.contract_name_count.set(&count);
        }

        #[cfg(test)]
        pub(super) fn set_info_for_test(
            &mut self,
            contract_name: &String,
            info: &NamedContractInfo,
        ) {
            self.info.insert(contract_name, info);
        }
    }

    fn validate_contract_name(contract_name: &String) -> Result<(), Error> {
        if contract_name.is_empty() {
            return Err(ContractNameEmpty.into());
        }
        if contract_name.as_bytes().len() > MAX_CONTRACT_NAME_LEN {
            return Err(ContractNameTooLong.into());
        }
        let bytes = contract_name.as_bytes();
        if !contract_name.is_ascii() || bytes.first() != Some(&b'@') {
            return Err(ContractNameInvalid.into());
        }

        let mut slash_idx: Option<usize> = None;
        for (idx, byte) in bytes.iter().copied().enumerate().skip(1) {
            if byte == b'/' {
                if slash_idx.is_some() {
                    return Err(ContractNameInvalid.into());
                }
                slash_idx = Some(idx);
            } else if !is_package_name_char(byte) {
                return Err(ContractNameInvalid.into());
            }
        }

        match slash_idx {
            Some(idx) if idx > 1 && idx + 1 < bytes.len() => Ok(()),
            _ => Err(ContractNameInvalid.into()),
        }
    }

    fn is_package_name_char(byte: u8) -> bool {
        byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
    }

    fn option_address(value: Address) -> OptionAddress {
        OptionAddress {
            isSome: true,
            value,
        }
    }

    fn option_address_none() -> OptionAddress {
        OptionAddress {
            isSome: false,
            value: Address::ZERO,
        }
    }

    fn option_string(value: String) -> OptionString {
        OptionString {
            isSome: true,
            value,
        }
    }

    fn option_string_none() -> OptionString {
        OptionString {
            isSome: false,
            value: String::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::contract_registry::{ContractRegistry, Error, NamedContractInfo};
    use pvm_contract_sdk::{Address, MockHost, MockHostBuilder};
    use std::string::String;

    const ALICE: Address = Address([0xA1; 20]);
    const BOB: Address = Address([0xB0; 20]);
    const CONTRACT_A: Address = Address([0xCA; 20]);
    const CONTRACT_B: Address = Address([0xCB; 20]);

    fn registry_with_caller(caller: Address) -> (ContractRegistry, MockHost) {
        let mock = MockHostBuilder::new().caller(caller.0).build();
        let registry = ContractRegistry::with_host(mock.clone());
        (registry, mock)
    }

    #[test]
    fn publish_new_contract_and_query_latest() {
        let (mut registry, _) = registry_with_caller(ALICE);
        let name = String::from("@example/counter");
        let uri = String::from("ipfs://metadata-v0");

        registry
            .publish_latest(name.clone(), CONTRACT_A, uri.clone())
            .expect("publish succeeds");

        assert_eq!(registry.get_contract_count(), 1);
        assert_eq!(registry.get_contract_name_at(0), name);
        assert_eq!(registry.get_owner(name.clone()), ALICE);
        assert_eq!(registry.get_version_count(name.clone()), 1);

        let address = registry.get_address(name.clone());
        assert!(address.isSome);
        assert_eq!(address.value, CONTRACT_A);

        let metadata = registry.get_metadata_uri(name);
        assert!(metadata.isSome);
        assert_eq!(metadata.value, uri);
    }

    #[test]
    fn publish_second_version_keeps_single_name_entry() {
        let (mut registry, _) = registry_with_caller(ALICE);
        let name = String::from("@example/counter");

        registry
            .publish_latest(name.clone(), CONTRACT_A, String::from("ipfs://v0"))
            .expect("first publish succeeds");
        registry
            .publish_latest(name.clone(), CONTRACT_B, String::from("ipfs://v1"))
            .expect("second publish succeeds");

        assert_eq!(registry.get_contract_count(), 1);
        assert_eq!(registry.get_version_count(name.clone()), 2);
        assert_eq!(registry.get_address(name.clone()).value, CONTRACT_B);
        assert_eq!(
            registry.get_address_at_version(name.clone(), 0).value,
            CONTRACT_A
        );
        assert_eq!(registry.get_address_at_version(name, 1).value, CONTRACT_B);
    }

    #[test]
    fn pagination_returns_latest_entries() {
        let (mut registry, _) = registry_with_caller(ALICE);

        registry
            .publish_latest(
                String::from("@example/one"),
                CONTRACT_A,
                String::from("ipfs://one"),
            )
            .expect("first publish succeeds");
        registry
            .publish_latest(
                String::from("@example/two"),
                CONTRACT_B,
                String::from("ipfs://two"),
            )
            .expect("second publish succeeds");

        let page = registry.get_contracts(0, 10);
        assert_eq!(page.total, 2);
        assert_eq!(page.entries.len(), 2);
        assert_eq!(page.entries[0].name, "@example/one");
        assert_eq!(page.entries[0].address, CONTRACT_A);
        assert_eq!(page.entries[1].name, "@example/two");
        assert_eq!(page.entries[1].address, CONTRACT_B);
    }

    #[test]
    fn unauthorized_owner_update_returns_typed_error() {
        let (mut registry, _) = registry_with_caller(BOB);
        let name = String::from("@example/counter");
        registry.set_info_for_test(
            &name,
            &NamedContractInfo {
                owner: ALICE,
                version_count: 1,
            },
        );

        let result = registry.publish_latest(name, CONTRACT_B, String::from("ipfs://v1"));

        assert!(matches!(result, Err(Error::Unauthorized(_))));
    }

    #[test]
    fn invalid_names_return_typed_errors() {
        let (mut registry, _) = registry_with_caller(ALICE);

        let empty = registry.publish_latest(String::new(), CONTRACT_A, String::from("ipfs://x"));
        assert!(matches!(empty, Err(Error::ContractNameEmpty(_))));

        let invalid =
            registry.publish_latest(String::from("example/counter"), CONTRACT_A, String::new());
        assert!(matches!(invalid, Err(Error::ContractNameInvalid(_))));

        let too_long = registry.publish_latest(
            String::from("@example/abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdef"),
            CONTRACT_A,
            String::new(),
        );
        assert!(matches!(too_long, Err(Error::ContractNameTooLong(_))));
    }

    #[test]
    fn overflow_paths_return_typed_errors() {
        let (mut registry, _) = registry_with_caller(ALICE);

        registry.set_contract_name_count_for_test(u32::MAX);
        let count_overflow =
            registry.publish_latest(String::from("@example/counter"), CONTRACT_A, String::new());
        assert!(matches!(
            count_overflow,
            Err(Error::ContractCountOverflow(_))
        ));

        let (mut registry, _) = registry_with_caller(ALICE);
        let name = String::from("@example/counter");
        registry.set_info_for_test(
            &name,
            &NamedContractInfo {
                owner: ALICE,
                version_count: u32::MAX,
            },
        );

        let version_overflow = registry.publish_latest(name, CONTRACT_A, String::new());
        assert!(matches!(version_overflow, Err(Error::VersionOverflow(_))));
    }

    #[test]
    fn missing_values_return_empty_options() {
        let (registry, _) = registry_with_caller(ALICE);
        let address = registry.get_address(String::from("@missing/package"));
        assert!(!address.isSome);
        assert_eq!(address.value, Address::ZERO);

        let metadata = registry.get_metadata_uri(String::from("@missing/package"));
        assert!(!metadata.isSome);
        assert_eq!(metadata.value, String::new());
    }
}
