//! Host-independent pieces of the ContractRegistry: fixed storage slots and
//! contract-name validation. Everything here is pure Rust with no chain or
//! SDK dependency, so it unit-tests on the host with plain `cargo test`.

#![cfg_attr(not(test), no_std)]

pub mod naming;
pub mod slots;

/// Hard cap on entries returned by a single paged query.
pub const MAX_PAGE_LIMIT: u32 = 100;
