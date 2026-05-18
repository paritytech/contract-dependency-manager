#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

cdm::import!("@example/counter");

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter_writer {
    use super::*;
    use pvm_contract_sdk::CallError;

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            CallError(CallError),
        }
    }

    pub struct CounterWriter;

    impl CounterWriter {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        /// Increment the shared counter by calling the counter contract via CDM.
        #[pvm_contract_sdk::method]
        pub fn write_increment(&mut self) -> Result<(), Error> {
            let counter = counter::Counter::cdm_lookup();
            counter.increment().call(self)?;
            Ok(())
        }

        /// Increment the shared counter N times.
        #[pvm_contract_sdk::method]
        pub fn write_increment_n(&mut self, n: u32) -> Result<(), Error> {
            let counter = counter::Counter::cdm_lookup();
            for _ in 0..n {
                counter.increment().call(self)?;
            }
            Ok(())
        }
    }
}
