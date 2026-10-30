//! First-publish initialization: record the owner and the `from` key.
//! Self-contained — it declares its own copy of the layout it operates on.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod init_set_owner {
    use pvm_contract_sdk::{Address, Lazy};

    pub struct InitSetOwner {
        count: Lazy<u32>,
        owner: Lazy<Address>,
        last_init_from: Lazy<u128>,
    }

    impl InitSetOwner {
        #[pvm_contract_sdk::method]
        pub fn initialize(&mut self, from: u128, owner: Address) {
            let _ = &self.count;
            self.owner.set(&owner);
            self.last_init_from.set(&from);
        }
    }
}
