#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

cdm::import!("@example/counter");

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter_reader {
    use super::*;

    pub struct CounterReader;

    impl CounterReader {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        /// Read the current count from the shared counter contract via CDM.
        #[pvm_contract_sdk::method]
        pub fn read_count(&self) -> u32 {
            let counter = counter::Counter::cdm_lookup();
            counter.get_count().call(self).expect("get_count failed")
        }
    }
}
