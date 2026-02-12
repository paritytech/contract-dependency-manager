#![no_main]
#![no_std]

use pvm_contract as pvm;

#[pvm::contract(cdm = "@example/counter-writer")]
mod counter_writer {
    use super::*;

    #[pvm::constructor]
    pub fn new() -> Result<(), Error> {
        Ok(())
    }

    /// Increment the shared counter by calling the counter contract via CDM
    #[pvm::method]
    pub fn write_increment() {
        let counter = counter::cdm_reference();
        counter.increment().expect("increment failed");
    }

    /// Increment the shared counter N times
    #[pvm::method]
    pub fn write_increment_n(n: u32) {
        let counter = counter::cdm_reference();
        for _ in 0..n {
            counter.increment().expect("increment failed");
        }
    }
}
