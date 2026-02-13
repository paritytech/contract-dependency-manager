#![no_main]
#![no_std]

use alloc::string::String;
use parity_scale_codec::{Decode, Encode};
use pvm::storage::Mapping;
use pvm::{Address, caller};
use pvm_contract as pvm;

pub type Version = u32;

/// A published contract version in the registry.
#[derive(Clone, Encode, Decode)]
pub struct PublishedContract {
    /// The address of the published contract.
    pub address: Address,
    /// Bulletin chain IPFS URI pointing to this contract version's metadata.
    pub metadata_uri: String,
}

#[derive(Default, Clone, Encode, Decode)]
pub struct NamedContractInfo {
    /// The owner of the contract name
    pub owner: Address,
    /// The number of versions published under this contract name.
    /// `version_count - 1` refers to the latest published version
    pub version_count: Version,
}

#[pvm::storage]
struct Storage {
    /// Count of registered contract names
    contract_name_count: u32,
    /// Maps index to contract name (simulates StorageVec)
    contract_name_at: Mapping<u32, String>,
    /// Stores all published versions of named contracts where the key for
    /// an individual versioned contract is given by `(contract_name, version)`
    published_address: Mapping<(String, Version), Address>,
    published_metadata_uri: Mapping<(String, Version), String>,
    /// Stores info about each registered contract name
    info: Mapping<String, NamedContractInfo>,
}

#[pvm::contract]
mod contract_registry {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Ok(())
    }

    /// Publish the latest version of a contract registered under name `contract_name`
    ///
    /// The caller only has permission to publish a new version of `contract_name` if
    /// either the name is available or they are already the owner of the name.
    #[pvm::method]
    pub fn publish_latest(contract_name: String, contract_address: Address, metadata_uri: String) {
        let caller = caller();

        // Get existing info or register new `contract_name` with caller as owner
        let mut info = match Storage::info().get(&contract_name) {
            Some(info) => info,
            None => {
                let info = NamedContractInfo {
                    owner: caller,
                    version_count: 0,
                };
                // Append to contract names list
                let count = Storage::contract_name_count().get().unwrap_or(0);
                Storage::contract_name_at().insert(&count, &contract_name);
                Storage::contract_name_count().set(&(count + 1));
                info
            }
        };

        // Abort if not owner
        if info.owner != caller {
            return;
        }

        // Increment version count & save info
        info.version_count = info
            .version_count
            .checked_add(1)
            .expect("publish_latest: version_count overflow");
        Storage::info().insert(&contract_name, &info);

        // Store published contract data at latest version index
        let version_idx = info.version_count.saturating_sub(1);
        Storage::published_address()
            .insert(&(contract_name.clone(), version_idx), &contract_address);
        Storage::published_metadata_uri().insert(&(contract_name, version_idx), &metadata_uri);
    }

    /// Get the address of the latest published contract for a given `contract_name`.
    /// This is the primary function used by CDM runtime lookups.
    #[pvm::method]
    pub fn get_address(contract_name: String) -> Address {
        let info = Storage::info().get(&contract_name);
        if let Some(info) = info {
            let latest_version = info.version_count.saturating_sub(1);
            Storage::published_address()
                .get(&(contract_name, latest_version))
                .unwrap_or_default()
        } else {
            Address::default()
        }
    }

    /// Get the metadata URI of the latest published contract for a given `contract_name`.
    #[pvm::method]
    pub fn get_metadata_uri(contract_name: String) -> String {
        let info = Storage::info().get(&contract_name);
        if let Some(info) = info {
            let latest_version = info.version_count.saturating_sub(1);
            Storage::published_metadata_uri()
                .get(&(contract_name, latest_version))
                .unwrap_or_default()
        } else {
            String::new()
        }
    }

    /// Get the contract name at a given index.
    #[pvm::method]
    pub fn get_contract_name_at(index: u32) -> String {
        Storage::contract_name_at().get(&index).unwrap_or_default()
    }

    /// Get the owner of a contract name.
    #[pvm::method]
    pub fn get_owner(contract_name: String) -> Address {
        Storage::info()
            .get(&contract_name)
            .map(|i| i.owner)
            .unwrap_or_default()
    }

    /// Get the version count for a contract name.
    #[pvm::method]
    pub fn get_version_count(contract_name: String) -> u32 {
        Storage::info()
            .get(&contract_name)
            .map(|i| i.version_count)
            .unwrap_or(0)
    }

    /// Get the number of contract names registered in the registry.
    #[pvm::method]
    pub fn get_contract_count() -> u32 {
        Storage::contract_name_count().get().unwrap_or(0)
    }
}
