//! Initialization for `@example/counter` version 0.1.0: runs exactly once,
//! inside the name's per-name proxy storage, in the same transaction that
//! publishes 0.1.0. No Cargo.toml entry needed — `cdm deploy` builds this
//! file on its own.
//!
//! The storage struct below is this file's own copy of the layout it operates
//! on. Initializations share nothing with the living contract: once 0.1.0 is
//! published this file is frozen text that can never break a future build,
//! and the deploy-time layout guard keeps the CURRENT initialization honest
//! against the CURRENT implementation.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter_init_0_1_0 {
    use pvm_contract_sdk::{Address, Lazy};

    #[pvm_contract_sdk::storage]
    pub struct CounterStorage {
        pub count: Lazy<u32>,
        pub owner: Lazy<Address>,
    }

    pub struct CounterInit {
        #[slot(0)]
        s: CounterStorage,
    }

    impl CounterInit {
        /// `from` is the previously-latest version key (0 on a first
        /// publish); `owner` is the name's registry owner.
        #[pvm_contract_sdk::method]
        pub fn initialize(&mut self, from: u128, owner: Address) {
            let _ = from;
            self.s.owner.set(&owner);
        }
    }
}
