#![no_main]
#![no_std]

mod allocator;

use pvm::storage::Lazy;
use pvm_contract as pvm;

#[pvm::storage]
struct Storage {
    count: u32,
}

#[pvm::contract(cdm = "@example/counter")]
mod counter {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Storage::count().set(&0);
        Ok(())
    }

    #[pvm::method]
    pub fn increment() {
        let current = Storage::count().get().unwrap_or(0);
        Storage::count().set(&(current + 1));
    }

    #[pvm::method]
    pub fn get_count() -> u32 {
        Storage::count().get().unwrap_or(0)
    }
}
