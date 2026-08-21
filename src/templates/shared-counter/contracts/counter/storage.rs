//! The counter's storage, shared between the main contract (`lib.rs`) and
//! every initialization under `initializations/` — one declaration, one
//! layout, so an initialization can never drift from the contract it
//! initializes.

use pvm_contract_sdk::{Address, Lazy};

/// Storage slots are auto-numbered in declaration order (`count` gets slot 0,
/// `owner` slot 1), exactly as if the fields were declared on the contract
/// struct directly.
#[pvm_contract_sdk::storage]
pub struct CounterStorage {
    pub count: Lazy<u32>,
    pub owner: Lazy<Address>,
}
