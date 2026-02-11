#![no_main]
#![no_std]

mod allocator;

use pvm_contract as pvm;

#[pvm::contract(cdm = "@example/counter-reader")]
mod counter_reader {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Ok(())
    }

    /// Read the current count from the shared counter contract via CDM
    #[pvm::method]
    pub fn read_count() -> u32 {
        let counter = counter::cdm_reference();
        counter.get_count().expect("get_count failed")
    }
}
