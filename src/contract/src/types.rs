//! ABI-facing types and errors for the registry contract.
//!
//! Everything here is plain data: the `#[contract]` module in `main.rs` holds
//! only storage and method bodies.

use alloc::string::String;
use alloc::vec::Vec;
use contract_registry_core::naming::NameError;
use pvm_contract_sdk::{Address, SolError, SolStorage, SolType};

/// A single row of `getContracts`: the latest published version of a
/// registered name. `version_key` is the packed semver key (legacy versions
/// derive as `0.0.(index+1)`); `address` follows `getAddress` semantics —
/// the per-name proxy when one exists, the latest standalone contract for
/// legacy names.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ContractEntry {
    pub name: String,
    pub version_key: u128,
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

/// One version row of `getVersionAt`, option-shaped like the other getters.
/// `target` is the implementation contract for proxied names and the
/// standalone published contract for legacy versions.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct OptionalVersionEntry {
    pub is_some: bool,
    pub version_key: u128,
    pub target: Address,
    pub metadata_uri: String,
}

/// One version of a contract in an `adminImportContracts` payload.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ImportContractVersion {
    pub version_key: u128,
    pub target: Address,
    pub metadata_uri: String,
}

/// A full contract history in an `adminImportContracts` payload. `proxy` is
/// the name's already-deployed per-name proxy, or zero for a legacy name —
/// import records state, it never instantiates.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ImportContract {
    pub contract_name: String,
    pub owner: Address,
    pub proxy: Address,
    pub versions: Vec<ImportContractVersion>,
}

/// Owner, published version count, and per-name proxy for a registered name.
///
/// Field order is load-bearing for the in-place v1 → v2 storage upgrade:
/// `owner` and `version_count` pack into the first slot exactly as v1 wrote
/// them, and `proxy` lands in a second slot v1 never touched — so pre-upgrade
/// records read back with `proxy == 0`, the legacy marker, with no migration.
/// `version_count == 0` means the name is unregistered.
#[derive(Debug, Clone, Copy, PartialEq, Eq, SolType, SolStorage)]
pub struct NamedContractInfo {
    pub owner: Address,
    pub version_count: u32,
    pub proxy: Address,
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

/// Version key is zero or not a packed `major.minor.patch` triple.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct InvalidVersionKey;

/// Published keys must be strictly increasing per name (legacy versions
/// count as `0.0.(index+1)`).
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct VersionNotMonotonic {
    pub attempted: u128,
    pub latest: u128,
}

/// First publish needs the per-name proxy blob's code hash configured.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ProxyCodeHashUnset;

/// Operation requires a per-name proxy, but the name is legacy (no proxy).
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct NoProxy;

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
    InvalidVersionKey(InvalidVersionKey),
    VersionNotMonotonic(VersionNotMonotonic),
    ProxyCodeHashUnset(ProxyCodeHashUnset),
    NoProxy(NoProxy),
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
