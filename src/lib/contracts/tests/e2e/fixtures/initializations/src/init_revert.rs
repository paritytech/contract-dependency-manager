//! Always-reverting initialization: proves an initialization revert rolls
//! back the ENTIRE publish (version count, latest key, storage — everything).

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

mod storage;

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_revert {
    use super::storage::FixtureStorage;
    use pvm_contract_sdk::{Address, SolError};

    /// `InitializationFailed()` — the selector the e2e suite asserts on.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct InitializationFailed;

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub enum Error {
        InitializationFailed(InitializationFailed),
    }

    pub struct InitRevert {
        #[slot(0)]
        s: FixtureStorage,
    }

    impl InitRevert {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        #[pvm_contract_sdk::method]
        pub fn cdm_init(&mut self, from: u128, owner: Address) -> Result<(), Error> {
            let _ = (from, owner, &self.s);
            Err(InitializationFailed.into())
        }
    }
}
