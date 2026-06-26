#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

// Workspace-sibling integration test for `cdm::import!`.
//
// The macro is exercised end-to-end: it locates cdm.json at this crate's
// root, resolves @test/sample → version 1, materializes its ABI to
// `.cdm/contracts/@test/sample/1/abi.json` from the inline ABI in cdm.json,
// then imports it.
//
// `ping_imported` references `.ping().call(self)` to force `cdm::import!` to
// expand `abi_import!` with `alloc = true`. Reverting the alloc flag (or
// removing the wrapper module that scopes `extern crate alloc;`) makes
// `cargo pvm-contract build` fail here.

cdm::import!("@test/sample");

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod harness {
    use super::*;

    pub struct Harness {}

    impl Harness {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        #[pvm_contract_sdk::method]
        pub fn ping_imported(&self) {
            let sample = sample::Sample::cdm_lookup();
            sample.ping().call(self).expect("ping failed");
        }
    }
}
