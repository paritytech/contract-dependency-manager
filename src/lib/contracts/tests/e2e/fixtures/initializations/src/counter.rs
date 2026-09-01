//! The fixture implementation contract: a counter with owner and
//! last-initialization bookkeeping. Published (as multiple versions of one
//! name) behind a per-name proxy by the initializations e2e suite.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter_fix {
    use pvm_contract_sdk::{Address, Lazy};

    #[pvm_contract_sdk::storage]
    pub struct FixtureStorage {
        pub count: Lazy<u32>,
        pub owner: Lazy<Address>,
        pub last_init_from: Lazy<u128>,
    }

    pub struct CounterFix {
        #[slot(0)]
        s: FixtureStorage,
    }

    impl CounterFix {
        #[pvm_contract_sdk::method]
        pub fn increment(&mut self) {
            let current = self.s.count.get();
            self.s.count.set(&(current + 1));
        }

        #[pvm_contract_sdk::method]
        pub fn get_count(&self) -> u32 {
            self.s.count.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_owner(&self) -> Address {
            self.s.owner.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_last_init_from(&self) -> u128 {
            self.s.last_init_from.get()
        }
    }
}
