//! Upgrade initialization: transform existing storage (double the counter)
//! and record the `from` key it migrated from.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

mod storage;

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_transform {
    use super::storage::FixtureStorage;
    use pvm_contract_sdk::Address;

    pub struct InitTransform {
        #[slot(0)]
        s: FixtureStorage,
    }

    impl InitTransform {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        #[pvm_contract_sdk::method]
        pub fn cdm_init(&mut self, from: u128, owner: Address) {
            let _ = owner;
            let current = self.s.count.get();
            self.s.count.set(&(current * 2));
            self.s.last_init_from.set(&from);
        }
    }
}
