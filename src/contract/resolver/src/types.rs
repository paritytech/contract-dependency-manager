//! ABI-facing types and errors for the resolver contract.

use alloc::vec::Vec;
use contract_registry_core::versioning::resolve;
use pvm_contract_sdk::{Address, Bytes, SolError, SolStorage, SolType};

/// What a shim does with the call it forwarded: `kind` is
/// `resolve::RETURN` (answer `payload`) or `resolve::DELEGATE` (delegate-call
/// `target` with `payload ++ data[strip..]`).
#[derive(Debug, PartialEq, Eq, SolType)]
pub struct Resolution {
    pub kind: u8,
    pub target: Address,
    pub strip: u32,
    pub payload: Bytes,
}

impl Resolution {
    pub fn delegate(target: Address, strip: usize) -> Self {
        Self {
            kind: resolve::DELEGATE,
            target,
            strip: strip as u32,
            payload: Bytes(Vec::new()),
        }
    }

    pub fn answer(payload: Vec<u8>) -> Self {
        Self {
            kind: resolve::RETURN,
            target: Address::ZERO,
            strip: 0,
            payload: Bytes(payload),
        }
    }
}

/// A name's routing state, keyed by its shim address. Zero `latest_key`
/// means nothing published yet; zero `min_supported` means no floor.
/// `fast_path_off` is the owner's opt-out from the shim's shortcut; a
/// `sealed` name is pinned to `latest_impl` and takes no further changes.
///
/// The field order packs this into two storage slots, the keys and then
/// `latest_impl` with the flags. A published name's `latest_impl` is never
/// zero, so flipping a flag never creates or removes a storage item: a freeze
/// or opt-out whose only deposit change is the shim's refund is submitted
/// with a zero deposit limit, which a charge here ahead of the shim call
/// would exhaust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, SolType, SolStorage)]
pub struct Routing {
    pub latest_key: u128,
    pub min_supported: u128,
    pub latest_impl: Address,
    pub frozen: bool,
    pub fast_path_off: bool,
    pub sealed: bool,
}

/// Versioned call for a key that was never published.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct UnknownVersion;

/// Versioned call below the owner's minimum supported floor.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct UnsupportedVersion {
    pub requested: u128,
    pub min_supported: u128,
}

/// Mutation or `callCode` from anyone but the registry.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct UnauthorizedAdmin;

/// Published keys must be strictly increasing.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct VersionNotMonotonic {
    pub attempted: u128,
    pub latest: u128,
}

/// Key is zero (reserved) or not a packed semver triple.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct InvalidVersionKey;

/// Publish or `callCode` target is the zero address.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct InvalidImplementation;

/// Magic-prefixed calldata too short for any CDM form, or undecodable
/// meta args.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct MalformedCall;

/// Meta call with an unrecognized selector.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct UnknownMetaSelector;

/// The min-supported floor only ratchets up.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct MinNotMonotonic {
    pub requested: u128,
    pub current: u128,
}

/// The min-supported floor cannot exceed the latest published version.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct MinAboveLatest {
    pub requested: u128,
    pub latest: u128,
}

/// Call arrived before the name's first publish.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct NoVersions;

/// Frozen: nothing is delegated until unfrozen; the meta plane still answers.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct ContractFrozen;

/// `setCode` target has no code on-chain.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct BadImplementation;

/// Sealed: the name's routing state never changes again.
#[derive(Debug, PartialEq, Eq, SolError)]
pub struct NameSealed;

#[derive(Debug, PartialEq, Eq, SolError)]
pub enum Error {
    UnknownVersion(UnknownVersion),
    UnsupportedVersion(UnsupportedVersion),
    UnauthorizedAdmin(UnauthorizedAdmin),
    VersionNotMonotonic(VersionNotMonotonic),
    InvalidVersionKey(InvalidVersionKey),
    InvalidImplementation(InvalidImplementation),
    MalformedCall(MalformedCall),
    UnknownMetaSelector(UnknownMetaSelector),
    MinNotMonotonic(MinNotMonotonic),
    MinAboveLatest(MinAboveLatest),
    NoVersions(NoVersions),
    ContractFrozen(ContractFrozen),
    BadImplementation(BadImplementation),
    NameSealed(NameSealed),
}
