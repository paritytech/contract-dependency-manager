//! CREATE3 child deployer.
//!
//! The factory CREATE2-instantiates one child per salt, so the child's
//! address is `create2(factory, child_code_hash, salt)`. The child then
//! CREATE1s the actual target exactly once, landing it at
//! `create1(child, 1)` — an address that commits to NEITHER the target's
//! code NOR its constructor input. Composed:
//!
//!   target = create1(create2(factory, child_code_hash, salt), 1)
//!          = f(factory, salt)
//!
//! This blob is a FROZEN, COMMITTED ARTIFACT: its bytes are part of every
//! address the factory will ever derive. Never rebuild it casually — a
//! changed child blob moves every future salt's address (past deployments
//! are unaffected).
//!
//! The child is deliberately never terminated: it stays on-chain occupying
//! its CREATE2 slot, which permanently burns the salt and makes redeploying
//! at a spent address impossible (revive rejects instantiation over an
//! existing contract).

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// polkavm-linker defaults guest stacks to 8 KiB; match resolc's default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 65536)]
mod create3_child {
    use alloc::vec;
    use alloc::vec::Vec;
    use pvm_contract_sdk::{Address, Bytes, HostApi, Lazy};

    #[derive(Debug, PartialEq, Eq, pvm_contract_sdk::SolError)]
    pub struct NotFactory;

    #[derive(Debug, PartialEq, Eq, pvm_contract_sdk::SolError)]
    pub struct AlreadyDeployed;

    #[derive(Debug, PartialEq, Eq, pvm_contract_sdk::SolError)]
    pub enum Error {
        NotFactory(NotFactory),
        AlreadyDeployed(AlreadyDeployed),
    }

    pub struct Create3Child {
        /// The factory that instantiated this child; the sole authorized caller.
        factory: Lazy<Address>,
        /// Set once the single CREATE1 has been performed.
        deployed: Lazy<bool>,
    }

    impl Create3Child {
        /// No constructor arguments, ever: revive's CREATE2 commits the
        /// constructor input into the address, and this child's address must
        /// be a pure function of (factory, salt, child code).
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            let factory = self.caller();
            self.factory.set(&factory);
        }

        /// CREATE1 the target from pre-uploaded `code_hash` with raw
        /// constructor calldata `input`. Callable once, by the factory only.
        /// The new contract lands at `create1(child, 1)` regardless of what
        /// `code_hash` and `input` contain; a failed target constructor
        /// bubbles its revert data unchanged.
        #[pvm_contract_sdk::method]
        pub fn deploy(&mut self, code_hash: [u8; 32], input: Bytes) -> Result<Address, Error> {
            if self.caller() != self.factory.get() {
                return Err(NotFactory.into());
            }
            if self.deployed.get() {
                return Err(AlreadyDeployed.into());
            }
            self.deployed.set(&true);

            // instantiate() input layout: 32-byte code hash of a pre-uploaded
            // blob, then the raw constructor calldata.
            let mut init: Vec<u8> = Vec::with_capacity(32 + input.0.len());
            init.extend_from_slice(&code_hash);
            init.extend_from_slice(&input.0);

            let host = self.host();
            let mut address = [0u8; 20];
            let result = host.instantiate(
                u64::MAX,
                u64::MAX,
                &[0xff; 32], // no deposit limit of its own — bounded by the parent frame
                &[0u8; 32],  // zero value
                &init,
                Some(&mut address),
                None,
                None, // CREATE1: address = f(child, nonce), code and input excluded
            );

            if result.is_err() {
                // Bubble the target constructor's revert data unchanged.
                let len = host.return_data_size() as usize;
                let mut revert_data = vec![0u8; len];
                let mut out: &mut [u8] = &mut revert_data;
                host.return_data_copy(&mut out, 0);
                host.revert(&revert_data);
            }
            Ok(Address(address))
        }

        #[pvm_contract_sdk::method]
        pub fn get_factory(&self) -> Address {
            self.factory.get()
        }

        fn caller(&self) -> Address {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            Address(caller)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::create3_child::{AlreadyDeployed, Create3Child, NotFactory};
    use pvm_contract_sdk::{Address, Bytes, MockHost, MockHostBuilder};

    const FACTORY: [u8; 20] = [0xFA; 20];
    const INTRUDER: [u8; 20] = [0xBB; 20];
    const TARGET: [u8; 20] = [0x77; 20];
    const CODE_HASH: [u8; 32] = [0xC0; 32];

    /// Child as the factory just instantiated it (constructor caller =
    /// factory), with a mocked instantiate result staged.
    fn child_from_factory() -> (Create3Child, MockHost) {
        let mock = MockHostBuilder::new()
            .caller(FACTORY)
            .mock_instantiate(TARGET, vec![])
            .build();
        let mut child = Create3Child::with_host(mock.clone());
        child.new();
        (child, mock)
    }

    #[test]
    fn constructor_pins_instantiating_factory() {
        let (child, _mock) = child_from_factory();
        assert_eq!(child.get_factory(), Address(FACTORY));
    }

    #[test]
    fn deploy_returns_created_address_exactly_once() {
        let (mut child, _mock) = child_from_factory();

        assert_eq!(
            child.deploy(CODE_HASH, Bytes(vec![1, 2, 3])),
            Ok(Address(TARGET))
        );
        // The single CREATE1 is spent, even for the factory.
        assert_eq!(
            child.deploy(CODE_HASH, Bytes(vec![])),
            Err(AlreadyDeployed.into())
        );
    }

    #[test]
    fn deploy_rejects_non_factory_callers() {
        let (child_host_side, mock) = child_from_factory();
        drop(child_host_side);

        // Same storage, different caller.
        let intruder_host = MockHostBuilder::new()
            .caller(INTRUDER)
            .mock_instantiate(TARGET, vec![])
            .build();
        for (key, value) in mock.storage_dump() {
            intruder_host.set_raw_storage(key, value);
        }
        let mut child = Create3Child::with_host(intruder_host.clone());

        assert_eq!(
            child.deploy(CODE_HASH, Bytes(vec![])),
            Err(NotFactory.into())
        );
    }
}
