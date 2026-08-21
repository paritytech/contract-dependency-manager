//! Shared storage for the fixture counter and its initializations — one
//! declaration, one layout.

use pvm_contract_sdk::{Address, Lazy};

#[pvm_contract_sdk::storage]
pub struct FixtureStorage {
    pub count: Lazy<u32>,
    pub owner: Lazy<Address>,
    /// The `from` version key the most recent initialization received —
    /// readable through the implementation so the e2e suite can assert the
    /// registry passed the previously-latest key.
    pub last_init_from: Lazy<u128>,
}
