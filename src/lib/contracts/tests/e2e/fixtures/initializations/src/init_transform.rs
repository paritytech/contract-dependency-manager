//! Upgrade initialization: transform existing storage (double the counter)
//! and record the `from` key it migrated from. Self-contained.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_transform {
    use pvm_contract_sdk::{Address, Lazy};

    #[pvm_contract_sdk::storage]
    pub struct FixtureStorage {
        pub count: Lazy<u32>,
        pub owner: Lazy<Address>,
        pub last_init_from: Lazy<u128>,
    }

    pub struct InitTransform {
        #[slot(0)]
        s: FixtureStorage,
    }

    impl InitTransform {
        #[pvm_contract_sdk::method]
        pub fn initialize(&mut self, from: u128, owner: Address) {
            let _ = owner;
            let current = self.s.count.get();
            self.s.count.set(&(current * 2));
            self.s.last_init_from.set(&from);
        }
    }
}
