#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

cdm::import!("@example/app-api");

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod support_contract {
    use super::*;
    use pvm_contract_sdk::CallError;

    pvm_contract_sdk::sol_revert_enum! {
        pub enum Error {
            CallError(CallError),
        }
    }

    pub struct SupportContract;

    impl SupportContract {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        /// Read the current count from the app-api contract via CDM.
        #[pvm_contract_sdk::method]
        pub fn read_count(&self) -> Result<u32, Error> {
            let api = app_api::AppApi::cdm_lookup();
            Ok(api.get_count().call(self)?)
        }
    }
}
