//! Initialization for `@example/counter` version 0.1.0.
//!
//! Runs exactly once, inside the name's per-name proxy storage, in the same
//! transaction that publishes 0.1.0. `from` is the previously-latest version
//! key (0 on a first publish) and `owner` is the name's registry owner.

#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[path = "../storage.rs"]
mod storage;

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod counter_init_0_1_0 {
    use super::storage::CounterStorage;
    use pvm_contract_sdk::Address;

    pub struct CounterInit {
        // The same shared storage struct at the same slot-0 anchor as the
        // main contract — the initialization sees exactly its layout.
        #[slot(0)]
        s: CounterStorage,
    }

    impl CounterInit {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        /// The conventional initialization entry point: the registry
        /// delegate-calls `cdmInit(uint128,address)` on the name's proxy
        /// when 0.1.0 is published.
        #[pvm_contract_sdk::method]
        pub fn cdm_init(&mut self, from: u128, owner: Address) {
            let _ = from; // 0 — this initialization ships with the first publish
            self.s.owner.set(&owner);
        }
    }
}
