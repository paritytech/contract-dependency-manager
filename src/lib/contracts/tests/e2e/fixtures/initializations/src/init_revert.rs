//! Always-reverting initialization: proves an initialization revert rolls
//! back the ENTIRE publish (version count, latest key, storage — everything).

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_revert {
    use pvm_contract_sdk::{Address, SolError};

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct InitializationFailed;

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub enum Error {
        InitializationFailed(InitializationFailed),
    }

    pub struct InitRevert;

    impl InitRevert {
        #[pvm_contract_sdk::method]
        pub fn initialize(&mut self, from: u128, owner: Address) -> Result<(), Error> {
            let _ = (from, owner);
            Err(InitializationFailed.into())
        }
    }
}
