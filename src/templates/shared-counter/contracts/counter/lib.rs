#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter {
    use pvm_contract_sdk::{Address, Lazy};

    /// One `#[storage]` struct anchored at slot 0: fields pack exactly as if
    /// declared bare on `Counter`, and the build emits the storage layout
    /// that CDM's initialization guard verifies at deploy time.
    #[pvm_contract_sdk::storage]
    pub struct CounterStorage {
        pub count: Lazy<u32>,
        pub owner: Lazy<Address>,
    }

    pub struct Counter {
        #[slot(0)]
        s: CounterStorage,
    }

    impl Counter {
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
    }
}
