//! ABI-facing types and errors for the registry contract.
//!
//! Everything here is plain data: the `#[contract]` module in `main.rs` holds
//! only storage and method bodies.

use alloc::string::String;
use alloc::vec::Vec;
use contract_registry_core::naming::NameError;
use pvm_contract_sdk::{Address, SolError, SolStorage, SolType};

/// A single row of `getContracts`: the latest published version of a
/// registered name. `version_key` is the packed semver key; `address` is the
/// name's per-name proxy — its permanent address.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ContractEntry {
    pub name: String,
    pub version_key: u128,
    pub address: Address,
    pub metadata_uri: String,
    pub owner: Address,
}

// Multi-value returns must stay single-tuple outputs: bare Rust tuples
// flatten to N outputs and change the wire bytes of dynamic returns, and
// every deployed registry and released CLI decodes the tuple layout.

/// `Option<Address>` as a single `(bool isSome, address value)` tuple.
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

/// `Option<String>` as a single `(bool isSome, string value)` tuple.
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

/// `getContracts` page as a single `(uint32 total, ContractEntry[] entries)`
/// tuple.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct ContractPage {
    pub total: u32,
    pub entries: Vec<ContractEntry>,
}

/// One version row of `getVersionAt`, option-shaped like the other getters.
/// `target` is the implementation contract the proxy delegate-calls for it.
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct OptionalVersionEntry {
    pub is_some: bool,
    pub version_key: u128,
    pub target: Address,
    pub metadata_uri: String,
}

/// One published version: the packed semver key and the implementation
/// contract the name's proxy delegate-calls for it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, SolType, SolStorage)]
pub struct VersionRecord {
    pub version_key: u128,
    pub target: Address,
}

/// `version_count == 0` means unregistered; every registered name has a proxy.
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
pub struct VersionOverflow;

/// `setCode` target or published implementation has no code on-chain.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct BadImplementation;

/// Version key is zero or not a packed `major.minor.patch` triple.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct InvalidVersionKey;

/// Published keys must be strictly increasing per name.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct VersionNotMonotonic {
    pub attempted: u128,
    pub latest: u128,
}

/// First publish needs the per-name proxy blob's code hash configured.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ProxyCodeHashUnset;

/// First publish needs the resolver address configured.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ResolverUnset;

/// The resolver address is written once; every shim bakes it in.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ResolverAlreadySet;

/// `setResolver` target is the zero address.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct InvalidResolver;

/// `publishWithInit` initialization target is the zero address.
/// Also returned when the target has no code on-chain.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct InvalidInitTarget;

#[derive(Debug, PartialEq, Eq, SolError)]
pub enum Error {
    Unauthorized(Unauthorized),
    UnauthorizedAdmin(UnauthorizedAdmin),
    ContractFrozen(ContractFrozen),
    ContractNameEmpty(ContractNameEmpty),
    ContractNameTooLong(ContractNameTooLong),
    ContractNameInvalid(ContractNameInvalid),
    VersionOverflow(VersionOverflow),
    BadImplementation(BadImplementation),
    InvalidVersionKey(InvalidVersionKey),
    VersionNotMonotonic(VersionNotMonotonic),
    ProxyCodeHashUnset(ProxyCodeHashUnset),
    ResolverUnset(ResolverUnset),
    ResolverAlreadySet(ResolverAlreadySet),
    InvalidResolver(InvalidResolver),
    InvalidInitTarget(InvalidInitTarget),
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
