#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter {
    use pvm_contract_sdk::{Address, Lazy};

    pub struct Counter {
        // Storage slots are auto-numbered in declaration order, packing
        // sub-word fields solc-style — count and owner share slot 0.
        count: Lazy<u32>,
        owner: Lazy<Address>,
    }

    impl Counter {
        #[pvm_contract_sdk::method]
        pub fn increment(&mut self) {
            let current = self.count.get();
            self.count.set(&(current + 1));
        }

        #[pvm_contract_sdk::method]
        pub fn get_count(&self) -> u32 {
            self.count.get()
        }

        #[pvm_contract_sdk::method]
        pub fn get_owner(&self) -> Address {
            self.owner.get()
        }
    }
}
