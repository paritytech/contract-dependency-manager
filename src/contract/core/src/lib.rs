//! Host-independent pieces of CDM's Rust contracts: the EIP-1967 storage
//! slots, the versioned-call wire format, and the shim ↔ resolver protocol.
//! Everything here is pure Rust with no chain dependency, so it unit-tests on
//! the host with plain `cargo test`.

#![cfg_attr(not(test), no_std)]

pub mod slots;
pub mod versioning;
