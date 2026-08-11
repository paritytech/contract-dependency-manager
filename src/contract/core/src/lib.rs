//! Host-independent pieces of the ContractRegistry: fixed storage slots,
//! contract-name validation, and the versioned-call wire format shared with
//! the per-name proxies. Everything here is pure Rust with no chain or SDK
//! dependency, so it unit-tests on the host with plain `cargo test`.

#![cfg_attr(not(test), no_std)]

pub mod naming;
pub mod slots;
pub mod versioning;

/// Hard cap on entries returned by a single paged query.
pub const MAX_PAGE_LIMIT: u32 = 100;
