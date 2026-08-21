//! First-publish initialization: record the owner and the `from` key.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

mod storage;

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_set_owner {
    use super::storage::FixtureStorage;
    use pvm_contract_sdk::Address;

    pub struct InitSetOwner {
        #[slot(0)]
        s: FixtureStorage,
    }

    impl InitSetOwner {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        #[pvm_contract_sdk::method]
        pub fn cdm_init(&mut self, from: u128, owner: Address) {
            self.s.owner.set(&owner);
            self.s.last_init_from.set(&from);
        }
    }
}
