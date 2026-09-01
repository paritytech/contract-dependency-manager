//! First-publish initialization: record the owner and the `from` key.
//! Self-contained — it embeds its own copy of the layout it operates on.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_set_owner {
    use pvm_contract_sdk::{Address, Lazy};

    #[pvm_contract_sdk::storage]
    pub struct FixtureStorage {
        pub count: Lazy<u32>,
        pub owner: Lazy<Address>,
        pub last_init_from: Lazy<u128>,
    }

    pub struct InitSetOwner {
        #[slot(0)]
        s: FixtureStorage,
    }

    impl InitSetOwner {
        #[pvm_contract_sdk::method]
        pub fn initialize(&mut self, from: u128, owner: Address) {
            self.s.owner.set(&owner);
            self.s.last_init_from.set(&from);
        }
    }
}
