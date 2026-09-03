//! Upgrade initialization: transform existing storage (double the counter)
//! and record the `from` key it migrated from. Self-contained.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_transform {
    use pvm_contract_sdk::{Address, Lazy};

    pub struct InitTransform {
        count: Lazy<u32>,
        owner: Lazy<Address>,
        last_init_from: Lazy<u128>,
    }

    impl InitTransform {
        #[pvm_contract_sdk::method]
        pub fn initialize(&mut self, from: u128, owner: Address) {
            let _ = (owner, &self.owner);
            let current = self.count.get();
            self.count.set(&(current * 2));
            self.last_init_from.set(&from);
        }
    }
}
