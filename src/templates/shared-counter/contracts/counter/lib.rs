#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter {
    use pvm_contract_sdk::Lazy;

    pub struct Counter {
        #[slot(0)]
        count: Lazy<u32>,
    }

    impl Counter {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            self.count.set(&0);
        }

        #[pvm_contract_sdk::method]
        pub fn increment(&mut self) {
            let current = self.count.get();
            self.count.set(&(current + 1));
        }

        #[pvm_contract_sdk::method]
        pub fn get_count(&self) -> u32 {
            self.count.get()
        }
    }
}
