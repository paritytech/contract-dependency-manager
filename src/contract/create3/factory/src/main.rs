//! CREATE3 factory.
//!
//! Deploys contracts at addresses that are a pure function of
//! `(factory address, salt)` — independent of the target's bytecode and
//! constructor input:
//!
//!   child  = create2(factory, child_code_hash, salt)   // fixed child blob
//!   target = create1(child, 1)                          // code-blind
//!
//! Deploy the factory itself once per network via CREATE2 from the same
//! account, with the same committed factory blob, the same child code hash
//! constructor argument, and the same salt — then every target address it
//! derives is identical on every network.
//!
//! Like the child, this blob is a FROZEN, COMMITTED ARTIFACT. The child
//! code hash is a constructor argument (not baked into this blob), so the
//! two artifacts stay decoupled; the TS bootstrap passes the committed hash.
//!
//! Deploys are owner-gated: a CREATE3 address does not commit to code, so
//! whoever may use the factory decides what lands at a salt. Gating deploys
//! keeps the salt namespace ours.

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// polkavm-linker defaults guest stacks to 8 KiB; match resolc's default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 131072)]
mod create3_factory {
    use alloc::vec;
    use pvm_contract_sdk::{
        Address, Bytes, CallFlags, HostApi, Lazy, SolDecode, SolEncode, const_selector,
    };

    #[derive(Debug, PartialEq, Eq, pvm_contract_sdk::SolError)]
    pub struct NotOwner;

    #[derive(Debug, PartialEq, Eq, pvm_contract_sdk::SolError)]
    pub struct ChildCallFailed;

    #[derive(Debug, PartialEq, Eq, pvm_contract_sdk::SolError)]
    pub enum Error {
        NotOwner(NotOwner),
        ChildCallFailed(ChildCallFailed),
    }

    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Deployed {
        #[indexed]
        pub salt: [u8; 32],
        pub address: Address,
        pub code_hash: [u8; 32],
    }

    pub struct Create3Factory {
        /// The only account allowed to consume salts.
        owner: Lazy<Address>,
        /// keccak-256 of the committed child deployer blob. Fixed at
        /// construction; every derived address commits to it.
        child_code_hash: Lazy<[u8; 32]>,
    }

    impl Create3Factory {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self, child_code_hash: [u8; 32]) {
            let deployer = self.caller();
            self.owner.set(&deployer);
            self.child_code_hash.set(&child_code_hash);
        }

        /// Deploy pre-uploaded `code_hash` with constructor calldata `input`
        /// at the deterministic address `predict(salt)`. Each salt is usable
        /// exactly once, forever (the child contract permanently occupies its
        /// CREATE2 slot). Target constructor reverts bubble unchanged.
        #[pvm_contract_sdk::method]
        pub fn deploy(
            &mut self,
            salt: [u8; 32],
            code_hash: [u8; 32],
            input: Bytes,
        ) -> Result<Address, Error> {
            if self.caller() != self.owner.get() {
                return Err(NotOwner.into());
            }

            let host = self.host();

            // 1) CREATE2 the child for this salt. Empty constructor input,
            //    so its address commits only to (factory, child blob, salt).
            //    A spent salt fails here (revive: DuplicateContract).
            let child_init = self.child_code_hash.get();
            let mut child = [0u8; 20];
            let created = host.instantiate(
                u64::MAX,
                u64::MAX,
                &[0xff; 32],
                &[0u8; 32],
                &child_init, // 32 bytes: the child code hash, no constructor data
                Some(&mut child),
                None,
                Some(&salt),
            );
            if created.is_err() {
                self.bubble_revert();
            }

            // 2) Have the child CREATE1 the target.
            let mut calldata = const_selector("deploy(bytes32,bytes)").to_vec();
            let args = (code_hash, input);
            let mut encoded = vec![0u8; args.encode_len()];
            args.encode_to(&mut encoded);
            calldata.extend_from_slice(&encoded);

            let mut output = [0u8; 32];
            let mut out: &mut [u8] = &mut output;
            let called = host.call_evm(
                CallFlags::empty(),
                &child,
                u64::MAX,
                &[0u8; 32],
                &calldata,
                Some(&mut out),
            );
            if called.is_err() {
                self.bubble_revert();
            }
            let address = Address::decode_at(&output, 0).map_err(|_| ChildCallFailed)?;

            Deployed {
                salt,
                address,
                code_hash,
            }
            .emit(host);
            Ok(address)
        }

        /// The address `deploy(salt, ..)` will (or did) produce — a pure
        /// function of this factory's address and the salt.
        #[pvm_contract_sdk::method]
        pub fn predict(&self, salt: [u8; 32]) -> Address {
            let mut factory = [0u8; 20];
            self.host().address(&mut factory);
            let child = self.create2_address(&factory, &salt, &self.child_code_hash.get());
            // The child's first (and only) instantiate happens at nonce 1:
            // revive initializes contract nonces to 1 at birth.
            Address(self.create1_address(&child))
        }

        #[pvm_contract_sdk::method]
        pub fn get_owner(&self) -> Address {
            self.owner.get()
        }

        #[pvm_contract_sdk::method]
        pub fn set_owner(&mut self, new_owner: Address) -> Result<(), Error> {
            if self.caller() != self.owner.get() {
                return Err(NotOwner.into());
            }
            self.owner.set(&new_owner);
            Ok(())
        }

        #[pvm_contract_sdk::method]
        pub fn get_child_code_hash(&self) -> [u8; 32] {
            self.child_code_hash.get()
        }

        // ─── Address derivation (mirrors pallet-revive's address.rs) ─────

        /// `keccak256(0xff ++ deployer ++ salt ++ init_code_hash)[12..]`.
        /// The child takes no constructor input, so its init-code hash is
        /// exactly the child code hash.
        pub fn create2_address(
            &self,
            deployer: &[u8; 20],
            salt: &[u8; 32],
            init_code_hash: &[u8; 32],
        ) -> [u8; 20] {
            let mut preimage = [0u8; 85];
            preimage[0] = 0xff;
            preimage[1..21].copy_from_slice(deployer);
            preimage[21..53].copy_from_slice(salt);
            preimage[53..85].copy_from_slice(init_code_hash);
            self.keccak_address(&preimage)
        }

        /// `keccak256(rlp([deployer, 1]))[12..]`. RLP of a 20-byte string and
        /// the integer 1 is fixed-shape: `0xd6 0x94 <20 bytes> 0x01`.
        pub fn create1_address(&self, deployer: &[u8; 20]) -> [u8; 20] {
            let mut preimage = [0u8; 23];
            preimage[0] = 0xd6; // list, payload length 22
            preimage[1] = 0x94; // string, length 20
            preimage[2..22].copy_from_slice(deployer);
            preimage[22] = 0x01; // nonce 1
            self.keccak_address(&preimage)
        }

        fn keccak_address(&self, preimage: &[u8]) -> [u8; 20] {
            let mut hash = [0u8; 32];
            self.host().hash_keccak_256(preimage, &mut hash);
            let mut address = [0u8; 20];
            address.copy_from_slice(&hash[12..]);
            address
        }

        fn caller(&self) -> Address {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            Address(caller)
        }

        /// Re-raise the current frame's failed sub-call with its return data.
        fn bubble_revert(&self) -> ! {
            let host = self.host();
            let len = host.return_data_size() as usize;
            let mut revert_data = vec![0u8; len];
            let mut out: &mut [u8] = &mut revert_data;
            host.return_data_copy(&mut out, 0);
            host.revert(&revert_data)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::create3_factory::{Create3Factory, NotOwner};
    use pvm_contract_sdk::{Address, Bytes, MockHost, MockHostBuilder, keccak256};

    const OWNER: [u8; 20] = [0xAA; 20];
    const INTRUDER: [u8; 20] = [0xBB; 20];
    const FACTORY_ADDR: [u8; 20] = [0xFA; 20];
    const CHILD: [u8; 20] = [0xC4; 20];
    const TARGET: [u8; 20] = [0x77; 20];
    const CHILD_CODE_HASH: [u8; 32] = [0xC0; 32];
    const SALT: [u8; 32] = [0x5A; 32];
    const TARGET_CODE_HASH: [u8; 32] = [0x11; 32];

    fn address_word(address: [u8; 20]) -> Vec<u8> {
        let mut word = vec![0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    fn deployed_factory() -> (Create3Factory, MockHost) {
        let mock = MockHostBuilder::new()
            .caller(OWNER)
            .address(FACTORY_ADDR)
            .mock_instantiate(CHILD, vec![])
            .mock_call(CHILD, Ok(address_word(TARGET)))
            .build();
        let mut factory = Create3Factory::with_host(mock.clone());
        factory.new(CHILD_CODE_HASH);
        (factory, mock)
    }

    #[test]
    fn constructor_pins_owner_and_child_code_hash() {
        let (factory, _mock) = deployed_factory();
        assert_eq!(factory.get_owner(), Address(OWNER));
        assert_eq!(factory.get_child_code_hash(), CHILD_CODE_HASH);
    }

    #[test]
    fn deploy_spawns_child_then_delegates_the_create1() {
        let (mut factory, mock) = deployed_factory();

        let result = factory.deploy(SALT, TARGET_CODE_HASH, Bytes(vec![0xAB, 0xCD]));
        assert_eq!(result, Ok(Address(TARGET)));

        // Exactly one call was made: child.deploy(code_hash, input).
        let calls = mock.take_recorded_calls();
        assert_eq!(calls.len(), 1);
        let (callee, calldata) = &calls[0];
        assert_eq!(*callee, CHILD);
        assert_eq!(&calldata[..4], &keccak256(b"deploy(bytes32,bytes)")[..4]);

        // Deployed event: topic0 + indexed salt, then (address, code_hash) data.
        let events = mock.events();
        assert_eq!(events.len(), 1);
        let (topics, data) = &events[0];
        assert_eq!(
            topics.as_slice(),
            &[keccak256(b"Deployed(bytes32,address,bytes32)"), SALT]
        );
        let mut expected_data = address_word(TARGET);
        expected_data.extend_from_slice(&TARGET_CODE_HASH);
        assert_eq!(data, &expected_data);
    }

    #[test]
    fn deploy_rejects_non_owner() {
        let (factory_host_side, mock) = deployed_factory();
        drop(factory_host_side);

        let intruder_host = MockHostBuilder::new()
            .caller(INTRUDER)
            .address(FACTORY_ADDR)
            .build();
        for (key, value) in mock.storage_dump() {
            intruder_host.set_raw_storage(key, value);
        }
        let mut factory = Create3Factory::with_host(intruder_host);

        assert_eq!(
            factory.deploy(SALT, TARGET_CODE_HASH, Bytes(vec![])),
            Err(NotOwner.into())
        );
        assert_eq!(factory.set_owner(Address(INTRUDER)), Err(NotOwner.into()));
    }

    #[test]
    fn set_owner_transfers_control() {
        let (mut factory, _mock) = deployed_factory();
        assert_eq!(factory.set_owner(Address(INTRUDER)), Ok(()));
        assert_eq!(factory.get_owner(), Address(INTRUDER));
    }

    // ─── Address derivation, checked against independent fixtures ─────────

    /// pallet-revive's own test vector (address.rs `create1_works`):
    /// `create1([0x01; 20], nonce 1) == c851da37e4e8d3a20d8d56be2963934b4ad71c3b`.
    #[test]
    fn create1_matches_pallet_revive_test_vector() {
        let (factory, _mock) = deployed_factory();
        let expected = [
            0xc8, 0x51, 0xda, 0x37, 0xe4, 0xe8, 0xd3, 0xa2, 0x0d, 0x8d, 0x56, 0xbe, 0x29, 0x63,
            0x93, 0x4b, 0x4a, 0xd7, 0x1c, 0x3b,
        ];
        assert_eq!(factory.create1_address(&[0x01; 20]), expected);
    }

    /// EIP-1014 example 4: deployer 0x00000000000000000000000000000000deadbeef,
    /// salt 0x…cafebabe, init_code 0xdeadbeef →
    /// 0x60f3f640a8508fC6a86d45DF051962668E1e8AC7.
    #[test]
    fn create2_matches_eip1014_test_vector() {
        let (factory, _mock) = deployed_factory();
        let mut deployer = [0u8; 20];
        deployer[16..].copy_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        let mut salt = [0u8; 32];
        salt[28..].copy_from_slice(&[0xca, 0xfe, 0xba, 0xbe]);
        let init_code_hash = keccak256(&[0xde, 0xad, 0xbe, 0xef]);

        let expected = [
            0x60, 0xf3, 0xf6, 0x40, 0xa8, 0x50, 0x8f, 0xc6, 0xa8, 0x6d, 0x45, 0xdf, 0x05, 0x19,
            0x62, 0x66, 0x8e, 0x1e, 0x8a, 0xc7,
        ];
        assert_eq!(
            factory.create2_address(&deployer, &salt, &init_code_hash),
            expected
        );
    }

    /// `predict` is the composition of the two derivations above.
    #[test]
    fn predict_composes_create2_then_create1() {
        let (factory, _mock) = deployed_factory();
        let child = factory.create2_address(&FACTORY_ADDR, &SALT, &CHILD_CODE_HASH);
        assert_eq!(
            factory.predict(SALT),
            Address(factory.create1_address(&child))
        );
    }
}
