#![no_main]
#![no_std]

use pvm::{Address, ReturnFlags, caller};
use pvm_contract as pvm;

fn revert(msg: &[u8]) -> ! {
    pvm::api::return_value(ReturnFlags::REVERT, msg)
}

#[pvm::storage]
struct Storage {
    owner: Address,
    registry_address: Address,
}

fn owner() -> Address {
    Storage::owner().get().unwrap_or_default()
}

fn ensure_owner() {
    if caller() != owner() {
        revert(b"Unauthorized");
    }
}

#[pvm::contract]
mod cdm_root {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::owner().set(&caller());
        Ok(())
    }

    #[pvm::method]
    pub fn get_registry_address() -> Address {
        Storage::registry_address().get().unwrap_or_default()
    }

    #[pvm::method]
    pub fn set_registry_address(registry_address: Address) {
        ensure_owner();
        Storage::registry_address().set(&registry_address);
    }

    #[pvm::method]
    pub fn get_owner() -> Address {
        owner()
    }

    #[pvm::method]
    pub fn set_owner(owner: Address) {
        ensure_owner();
        Storage::owner().set(&owner);
    }
}
