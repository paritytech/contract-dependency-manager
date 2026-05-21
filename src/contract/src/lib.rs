#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 65536)]
mod contract_registry {
    use alloc::string::String;
    use alloc::vec::Vec;
    use pvm_contract_sdk::{Address, HostApi, Lazy, Mapping};

    pub type Version = u32;

    const MAX_CONTRACT_NAME_LEN: usize = 64;
    const MAX_SEARCH_LIMIT: u32 = 100;

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            Unauthorized(Unauthorized),
            VersionOverflow(VersionOverflow),
            ContractCountOverflow(ContractCountOverflow),
            ContractNameEmpty(ContractNameEmpty),
            ContractNameTooLong(ContractNameTooLong),
            ContractNameInvalid(ContractNameInvalid),
        }
    }

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct Unauthorized;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct VersionOverflow;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractCountOverflow;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractNameEmpty;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractNameTooLong;

    #[derive(Debug, pvm_contract_sdk::SolError)]
    pub struct ContractNameInvalid;

    #[derive(Clone, pvm_contract_sdk::SolType)]
    pub struct NamedContractInfo {
        /// The owner of the contract name.
        pub owner: Address,
        /// `version_count - 1` is the latest published version index.
        /// Zero means the name is unregistered.
        pub version_count: u32,
    }

    impl Default for NamedContractInfo {
        fn default() -> Self {
            Self {
                owner: Address::ZERO,
                version_count: 0,
            }
        }
    }

    #[derive(Clone, pvm_contract_sdk::SolType)]
    pub struct ContractNameSearchPage {
        pub names: Vec<String>,
        pub next_offset: u32,
        pub done: bool,
    }

    fn validate_contract_name(contract_name: &str) -> Result<(), Error> {
        if contract_name.is_empty() {
            return Err(ContractNameEmpty.into());
        }
        if contract_name.len() > MAX_CONTRACT_NAME_LEN {
            return Err(ContractNameTooLong.into());
        }
        if !contract_name.is_ascii() {
            return Err(ContractNameInvalid.into());
        }
        Ok(())
    }

    pub struct ContractRegistry {
        /// Count of registered contract names.
        #[slot(0)]
        contract_name_count: Lazy<u32>,
        /// Maps index to contract name (simulates a StorageVec).
        #[slot(1)]
        contract_name_at: Mapping<u32, String>,
        /// `(contract_name, version) → address` for every published version.
        #[slot(2)]
        published_address: Mapping<(String, Version), Address>,
        /// `(contract_name, version) → metadata_uri` for every published version.
        #[slot(3)]
        published_metadata_uri: Mapping<(String, Version), String>,
        /// `contract_name → (owner address, version count)`.
        #[slot(4)]
        info: Mapping<String, NamedContractInfo>,
    }

    impl ContractRegistry {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            self.contract_name_count.set(&0);
        }

        /// Publish the latest version of a contract registered under `contract_name`.
        ///
        /// The caller can publish a new version only if the name is unregistered
        /// (in which case caller becomes the owner) or the caller is the current
        /// owner of the name.
        #[pvm_contract_sdk::method]
        pub fn publish_latest(
            &mut self,
            contract_name: String,
            contract_address: Address,
            metadata_uri: String,
        ) -> Result<(), Error> {
            validate_contract_name(&contract_name)?;

            let caller = self.caller();
            let mut info = self.info.get(&contract_name);
            if info.version_count == 0 {
                // First-time registration: claim the name.
                info.owner = caller;
                let count = self.contract_name_count.get();
                self.contract_name_at.insert(&count, &contract_name);
                self.contract_name_count
                    .set(&count.checked_add(1).ok_or(ContractCountOverflow)?);
            } else if info.owner != caller {
                return Err(Unauthorized.into());
            }

            info.version_count = info.version_count.checked_add(1).ok_or(VersionOverflow)?;
            self.info.insert(&contract_name, &info);

            let version_idx = info.version_count - 1;
            self.published_address
                .insert(&(contract_name.clone(), version_idx), &contract_address);
            self.published_metadata_uri
                .insert(&(contract_name, version_idx), &metadata_uri);
            Ok(())
        }

        /// Search registered contract names by prefix.
        ///
        /// The pre-sm/cdm registry used a sorted `OrderedIndex` for O(log n)
        /// prefix lookups. The new SDK's storage layer doesn't expose ordered
        /// indices, so this is a linear scan over `contract_name_at` (cheap
        /// for the current registry sizes; revisit if `OrderedIndex` lands).
        ///
        /// Returns up to `limit` (capped at `MAX_SEARCH_LIMIT`) names matching
        /// `prefix`, starting from name-index `offset` in registration order.
        /// `done = true` when the scan reached the end of the registry.
        #[pvm_contract_sdk::method]
        pub fn search_contract_names(
            &self,
            prefix: String,
            offset: u32,
            limit: u32,
        ) -> ContractNameSearchPage {
            let cap = limit.min(MAX_SEARCH_LIMIT);
            if cap == 0 || prefix.len() > MAX_CONTRACT_NAME_LEN || !prefix.is_ascii() {
                return ContractNameSearchPage {
                    names: Vec::new(),
                    next_offset: offset,
                    done: true,
                };
            }

            let total = self.contract_name_count.get();
            let mut names = Vec::new();
            let mut idx = offset;
            while idx < total && (names.len() as u32) < cap {
                let name = self.contract_name_at.get(&idx);
                if name.starts_with(prefix.as_str()) {
                    names.push(name);
                }
                idx += 1;
            }

            ContractNameSearchPage {
                names,
                next_offset: idx,
                done: idx >= total,
            }
        }

        /// Address of the latest published version of `contract_name`.
        /// Returns `Address::ZERO` when the name is unregistered.
        #[pvm_contract_sdk::method]
        pub fn get_address(&self, contract_name: String) -> Address {
            let info = self.info.get(&contract_name);
            if info.version_count == 0 {
                return Address::ZERO;
            }
            self.published_address
                .get(&(contract_name, info.version_count - 1))
        }

        /// Metadata URI of the latest published version of `contract_name`.
        /// Returns the empty string when the name is unregistered.
        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri(&self, contract_name: String) -> String {
            let info = self.info.get(&contract_name);
            if info.version_count == 0 {
                return String::new();
            }
            self.published_metadata_uri
                .get(&(contract_name, info.version_count - 1))
        }

        /// Address of a specific version of `contract_name`.
        /// Returns `Address::ZERO` when the version is unregistered.
        #[pvm_contract_sdk::method]
        pub fn get_address_at_version(&self, contract_name: String, version: Version) -> Address {
            self.published_address.get(&(contract_name, version))
        }

        /// Metadata URI of a specific version of `contract_name`.
        /// Returns the empty string when the version is unregistered.
        #[pvm_contract_sdk::method]
        pub fn get_metadata_uri_at_version(
            &self,
            contract_name: String,
            version: Version,
        ) -> String {
            self.published_metadata_uri.get(&(contract_name, version))
        }

        /// Contract name at a given index in the registration order.
        #[pvm_contract_sdk::method]
        pub fn get_contract_name_at(&self, index: u32) -> String {
            self.contract_name_at.get(&index)
        }

        /// Owner of a contract name. Returns `Address::ZERO` when unregistered.
        #[pvm_contract_sdk::method]
        pub fn get_owner(&self, contract_name: String) -> Address {
            self.info.get(&contract_name).owner
        }

        /// Number of versions published under `contract_name`. Zero means unregistered.
        #[pvm_contract_sdk::method]
        pub fn get_version_count(&self, contract_name: String) -> Version {
            self.info.get(&contract_name).version_count
        }

        /// Number of distinct contract names registered.
        #[pvm_contract_sdk::method]
        pub fn get_contract_count(&self) -> u32 {
            self.contract_name_count.get()
        }

        fn caller(&self) -> Address {
            let mut buf = [0u8; 20];
            self.host().caller(&mut buf);
            Address(buf)
        }
    }
}
