#![no_main]
#![no_std]

use alloc::string::String;
use parity_scale_codec::{Decode, Encode};
use pvm::storage::Mapping;
use pvm::{Address, ReturnFlags, caller};
use pvm_contract as pvm;

fn revert(msg: &[u8]) -> ! {
    pvm::api::return_value(ReturnFlags::REVERT, msg)
}

pub type Version = u32;
const MAX_CONTRACT_NAME_LEN: usize = 64;
const MAX_PAGE_LIMIT: u32 = 100;

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

#[derive(Default, pvm::SolAbi)]
pub struct ContractEntry {
    pub name: String,
    pub version: Version,
    pub address: Address,
    pub metadata_uri: String,
    pub owner: Address,
}

#[derive(Default, pvm::SolAbi)]
pub struct ContractPage {
    pub total: u32,
    pub entries: alloc::vec::Vec<ContractEntry>,
}

fn validate_contract_name(contract_name: &String) {
    if contract_name.is_empty() {
        revert(b"ContractNameEmpty");
    }
    if contract_name.as_bytes().len() > MAX_CONTRACT_NAME_LEN {
        revert(b"ContractNameTooLong");
    }
    let bytes = contract_name.as_bytes();
    if !contract_name.is_ascii() || bytes.first() != Some(&b'@') {
        revert(b"ContractNameInvalid");
    }

    let mut slash_idx: Option<usize> = None;
    for (idx, byte) in bytes.iter().copied().enumerate().skip(1) {
        if byte == b'/' {
            if slash_idx.is_some() {
                revert(b"ContractNameInvalid");
            }
            slash_idx = Some(idx);
        } else if !is_package_name_char(byte) {
            revert(b"ContractNameInvalid");
        }
    }

    match slash_idx {
        Some(idx) if idx > 1 && idx + 1 < bytes.len() => {}
        _ => revert(b"ContractNameInvalid"),
    }
}

fn is_package_name_char(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_'
}

fn latest_contract_entry(contract_name: String) -> Option<ContractEntry> {
    let info = Storage::info().get(&contract_name)?;
    if info.version_count == 0 {
        return None;
    }

    let version = info.version_count.saturating_sub(1);
    let key = (contract_name.clone(), version);
    let address = Storage::published_address().get(&key)?;
    let metadata_uri = Storage::published_metadata_uri().get(&key)?;

    Some(ContractEntry {
        name: contract_name,
        version,
        address,
        metadata_uri,
        owner: info.owner,
    })
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
        validate_contract_name(&contract_name);

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
                Storage::contract_name_count().set(
                    &count
                        .checked_add(1)
                        .unwrap_or_else(|| revert(b"ContractCountOverflow")),
                );
                info
            }
        };

        // Only the owner can publish under this name
        if info.owner != caller {
            revert(b"Unauthorized");
        }

        // Increment version count & save info
        info.version_count = match info.version_count.checked_add(1) {
            Some(v) => v,
            None => revert(b"VersionOverflow"),
        };
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
    pub fn get_address(contract_name: String) -> Option<Address> {
        let info = Storage::info().get(&contract_name);
        if let Some(info) = info {
            let latest_version = info.version_count.saturating_sub(1);
            Storage::published_address().get(&(contract_name, latest_version))
        } else {
            None
        }
    }

    /// Get the metadata URI of the latest published contract for a given `contract_name`.
    #[pvm::method]
    pub fn get_metadata_uri(contract_name: String) -> Option<String> {
        let info = Storage::info().get(&contract_name);
        if let Some(info) = info {
            let latest_version = info.version_count.saturating_sub(1);
            Storage::published_metadata_uri().get(&(contract_name, latest_version))
        } else {
            None
        }
    }

    /// Get the address of a specific version of a contract.
    #[pvm::method]
    pub fn get_address_at_version(contract_name: String, version: u32) -> Option<Address> {
        Storage::published_address().get(&(contract_name, version))
    }

    /// Get the metadata URI of a specific version of a contract.
    #[pvm::method]
    pub fn get_metadata_uri_at_version(contract_name: String, version: u32) -> Option<String> {
        Storage::published_metadata_uri().get(&(contract_name, version))
    }

    /// Get the contract name at a given index.
    #[pvm::method]
    pub fn get_contract_name_at(index: u32) -> String {
        Storage::contract_name_at().get(&index).unwrap_or_default()
    }

    /// Get a page of latest contract entries by append-only registry index.
    #[pvm::method]
    pub fn get_contracts(start: u32, count: u32) -> ContractPage {
        let total = Storage::contract_name_count().get().unwrap_or(0);
        let cap = if count > MAX_PAGE_LIMIT {
            MAX_PAGE_LIMIT
        } else {
            count
        };
        let mut entries: alloc::vec::Vec<ContractEntry> = alloc::vec::Vec::new();

        if total > 0 && start < total && cap > 0 {
            let mut scanned = 0u32;

            loop {
                let index = start.saturating_add(scanned);
                if scanned >= cap || index >= total {
                    break;
                }

                if let Some(name) = Storage::contract_name_at().get(&index) {
                    if let Some(entry) = latest_contract_entry(name) {
                        entries.push(entry);
                    }
                }

                scanned = scanned.saturating_add(1);
            }
        }

        ContractPage { total, entries }
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
