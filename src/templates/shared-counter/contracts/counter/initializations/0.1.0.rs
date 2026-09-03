//! Initialization for `@example/counter` version 0.1.0: runs exactly once, in
//! the name's proxy storage, inside the transaction that publishes 0.1.0. No
//! Cargo.toml entry needed — `cdm deploy` builds this file on its own.
//!
//! The struct is this file's own copy of the contract's storage layout; the
//! deploy-time layout guard checks it against the implementation.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter_init_0_1_0 {
    use pvm_contract_sdk::{Address, Lazy};

    pub struct CounterInit {
        count: Lazy<u32>,
    }

    impl CounterInit {
        /// `from` is the previously-latest version key (0 on a first
        /// publish); `owner` is the name's registry owner.
        #[pvm_contract_sdk::method]
        pub fn initialize(&mut self, _from: u128, _owner: Address) {
            // Demonstrative — set genuine starting state or transform existing state here.
            self.count.set(&0);
        }
    }
}
