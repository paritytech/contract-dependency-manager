//! What CDM's Rust contracts share: the pallet-revive host calls they make,
//! behind one trait, and the few ABI helpers they read calldata with.
//!
//! A contract's logic is written against [`Host`]. In a contract build that
//! is [`Chain`], a thin wrapper over `pallet-revive-uapi`; in unit tests it
//! is the pvm-contract-sdk mock host (the `mock` feature, which contracts
//! enable from their dev-dependencies only).

#![no_std]

pub mod abi;
#[cfg(target_arch = "riscv64")]
mod chain;
#[cfg(feature = "mock")]
pub mod mock;

#[cfg(target_arch = "riscv64")]
pub use chain::Chain;

pub trait Host {
    fn call_data_size(&self) -> usize;
    /// Copy calldata from `offset` into `output`.
    fn call_data_copy(&self, output: &mut [u8], offset: usize);
    /// The word stored at `key`, zero when nothing is.
    fn load(&self, key: &[u8; 32]) -> [u8; 32];
    /// Store `value` at `key`; an all-zero word removes the entry.
    fn store(&self, key: &[u8; 32], value: &[u8; 32]);
    /// The address of the executing contract.
    fn address(&self) -> [u8; 20];
    fn caller(&self) -> [u8; 20];
    /// The value sent with the call, as a big-endian word.
    fn value(&self) -> [u8; 32];
    /// Read the contract's immutable data into `output`.
    fn immutable_data(&self, output: &mut [u8]);
    /// Write the contract's immutable data. Constructor only.
    fn set_immutable_data(&self, data: &[u8]);
    /// Call `callee` with no value; `false` when it reverted or trapped.
    fn call(&self, callee: &[u8; 20], input: &[u8]) -> bool;
    /// Read-only call; `false` when the callee reverted or trapped.
    fn static_call(&self, callee: &[u8; 20], input: &[u8]) -> bool;
    /// Tail delegate-call: the callee's return or revert ends this call too,
    /// so on chain only a call that could not run comes back, as `false`.
    fn delegate_call(&self, target: &[u8; 20], input: &[u8]) -> bool;
    /// Instantiate uploaded code. `input` is the 32-byte code hash followed
    /// by the constructor input; a `salt` makes the address independent of
    /// the caller's nonce. `None` when the constructor reverted or trapped.
    fn instantiate(&self, input: &[u8], salt: Option<&[u8; 32]>) -> Option<[u8; 20]>;
    /// Size of the last call's or instantiation's return data.
    fn return_data_size(&self) -> usize;
    /// Copy that return data into `output`, from its start.
    fn return_data_copy(&self, output: &mut [u8]);
    fn keccak256(&self, input: &[u8]) -> [u8; 32];
    fn emit(&self, topics: &[[u8; 32]], data: &[u8]);
    /// End the call returning `data`. On chain this never returns.
    fn answer(&self, data: &[u8]);
    /// End the call reverting with `data`.
    fn revert(&self, data: &[u8]) -> !;
}

/// Revert with empty data if the call carries value.
pub fn reject_value<H: Host>(host: &H) {
    if host.value() != [0u8; 32] {
        host.revert(&[]);
    }
}
