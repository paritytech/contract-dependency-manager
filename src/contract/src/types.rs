//! ABI-facing types and errors for the registry contract.
//!
//! Everything here is plain data: the `#[contract]` module in `lib.rs` holds
//! only storage and method bodies.

use alloc::string::String;
use alloc::vec::Vec;
use contract_registry_core::naming::NameError;
use pvm_contract_sdk::{Address, SolError, SolStorage, SolType};

/// A single row of `getContracts`: the latest published version of a
/// registered name.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ContractEntry {
    pub name: String,
    pub version: u32,
    pub address: Address,
    pub metadata_uri: String,
    pub owner: Address,
}

// The old SDK encoded every multi-value return as ONE tuple output; the new
// SDK flattens bare Rust tuples into N outputs, which changes the wire bytes
// for dynamic returns (an extra leading offset word). The structs below
// reproduce the old single-tuple format exactly, so one ABI decodes every
// registry generation ever deployed. Do not replace them with bare tuples.

/// `Option<Address>` in the registry's historical wire format:
/// a single `(bool isSome, address value)` tuple output.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct OptionalAddress {
    pub is_some: bool,
    pub value: Address,
}

impl From<Option<Address>> for OptionalAddress {
    fn from(value: Option<Address>) -> Self {
        Self {
            is_some: value.is_some(),
            value: value.unwrap_or(Address::ZERO),
        }
    }
}

/// `Option<String>` in the registry's historical wire format:
/// a single `(bool isSome, string value)` tuple output.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct OptionalString {
    pub is_some: bool,
    pub value: String,
}

impl From<Option<String>> for OptionalString {
    fn from(value: Option<String>) -> Self {
        Self {
            is_some: value.is_some(),
            value: value.unwrap_or_default(),
        }
    }
}

/// `getContracts` page in the historical wire format: a single
/// `(uint32 total, ContractEntry[] entries)` tuple output.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ContractPage {
    pub total: u32,
    pub entries: Vec<ContractEntry>,
}

/// One version of a contract in an `adminImportContracts` payload.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ImportContractVersion {
    pub address: Address,
    pub metadata_uri: String,
}

/// A full contract history in an `adminImportContracts` payload. Field order
/// is load-bearing: it must match the `cdm.registry.v1` snapshot schema the
/// migration tooling encodes against.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ImportContract {
    pub contract_name: String,
    pub owner: Address,
    pub versions: Vec<ImportContractVersion>,
}

/// Owner and version count for a registered name. Static (20 + 4 bytes), so
/// it packs into a single storage slot. `version_count == 0` means the name
/// is unregistered — every registered name has at least one version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, SolType, SolStorage)]
pub struct NamedContractInfo {
    pub owner: Address,
    pub version_count: u32,
}

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct Unauthorized;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct UnauthorizedAdmin;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ContractFrozen;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ContractNameEmpty;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ContractNameTooLong;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ContractNameInvalid;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ImportVersionsEmpty;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ImportContractExists;

#[derive(Debug, PartialEq, Eq, SolError)]
pub struct VersionOverflow;

/// `setCode` target has no code on-chain.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct BadImplementation;

#[derive(Debug, PartialEq, Eq, SolError)]
pub enum Error {
    Unauthorized(Unauthorized),
    UnauthorizedAdmin(UnauthorizedAdmin),
    ContractFrozen(ContractFrozen),
    ContractNameEmpty(ContractNameEmpty),
    ContractNameTooLong(ContractNameTooLong),
    ContractNameInvalid(ContractNameInvalid),
    ImportVersionsEmpty(ImportVersionsEmpty),
    ImportContractExists(ImportContractExists),
    VersionOverflow(VersionOverflow),
    BadImplementation(BadImplementation),
}

impl From<NameError> for Error {
    fn from(err: NameError) -> Self {
        match err {
            NameError::Empty => ContractNameEmpty.into(),
            NameError::TooLong => ContractNameTooLong.into(),
            NameError::Invalid => ContractNameInvalid.into(),
        }
    }
}
