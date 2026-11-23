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
//!
//! **Constructor** — no arguments, ever: revive's CREATE2 commits the
//! constructor input into the address, and this child's address must be a
//! pure function of (factory, salt, child code). It records its caller as
//! the factory.
//!
//! **Storage** — one word at slot 0:
//! `[11 zero bytes][deployed: 1 byte][factory: 20 bytes]`.
//!
//! **Methods**
//!
//! - `deploy(bytes32 codeHash, bytes input) returns (address)` `0xcdcb760a`
//!   CREATE1s the target from pre-uploaded `codeHash` with raw constructor
//!   calldata `input`. It reverts `NotFactory()` unless the caller is the
//!   factory, then `AlreadyDeployed()` if it has run before. The target
//!   lands at `create1(child, 1)` whatever `codeHash` and `input` contain; a
//!   target constructor that fails bubbles its revert data unchanged.
//! - `getFactory() returns (address)` `0x88cc58e4`.
//!
//! Arguments are read as the ABI lays them out, starting after the selector.
//! `input` is found through its offset word, and only the low 8 bytes of
//! that word and of the length word are read. Bytes past a method's
//! arguments are ignored. Arguments are read before the caller is checked.
//!
//! A call with value, with fewer than 4 bytes, with an unknown selector, or
//! with calldata too short to hold its arguments reverts with empty data. So
//! does a constructor sent value.

#![cfg_attr(target_arch = "riscv64", no_std, no_main)]

use contract_host::abi::{SELECTOR_LEN, bytes_argument, selector};
use contract_host::{Host, reject_value};

/// pallet-revive caps calldata and return data at this many bytes each.
const MAX_DATA: usize = 128 * 1024;
/// `[code hash][constructor input]`, as `instantiate` takes it. A failed
/// instantiation's return data fits too.
pub const BUFFER_LEN: usize = 32 + MAX_DATA;

/// The child's storage word.
const STATE_SLOT: [u8; 32] = [0u8; 32];
/// The byte of the storage word that is non-zero once `deploy` has run.
const DEPLOYED: usize = 11;
/// The bytes of the storage word holding the factory.
const FACTORY: core::ops::Range<usize> = 12..32;

const DEPLOY: [u8; 4] = selector(b"deploy(bytes32,bytes)");
const GET_FACTORY: [u8; 4] = selector(b"getFactory()");
const NOT_FACTORY: [u8; 4] = selector(b"NotFactory()");
const ALREADY_DEPLOYED: [u8; 4] = selector(b"AlreadyDeployed()");

/// The constructor: records the caller as the factory.
pub fn construct<H: Host>(host: &H) {
    reject_value(host);
    let mut state = [0u8; 32];
    state[FACTORY].copy_from_slice(&host.caller());
    host.store(&STATE_SLOT, &state);
}

/// Every call lands here. `buffer` is scratch space of [`BUFFER_LEN`] bytes.
pub fn call<H: Host>(host: &H, buffer: &mut [u8]) {
    reject_value(host);
    let size = host.call_data_size();
    if size < SELECTOR_LEN {
        host.revert(&[]);
    }
    let mut selector = [0u8; SELECTOR_LEN];
    host.call_data_copy(&mut selector, 0);

    match selector {
        DEPLOY => deploy(host, size, buffer),
        GET_FACTORY => {
            let mut word = [0u8; 32];
            word[FACTORY].copy_from_slice(&host.load(&STATE_SLOT)[FACTORY]);
            host.answer(&word);
        }
        _ => host.revert(&[]),
    }
}

/// `deploy(bytes32 codeHash, bytes input)`, the calldata being `size` bytes.
fn deploy<H: Host>(host: &H, size: usize, buffer: &mut [u8]) {
    let mut head = [0u8; 64];
    if size < SELECTOR_LEN + head.len() {
        host.revert(&[]);
    }
    host.call_data_copy(&mut head, SELECTOR_LEN);
    let Some((input_start, input_len)) = bytes_argument(host, size, &head[32..]) else {
        host.revert(&[])
    };

    let mut state = host.load(&STATE_SLOT);
    if host.caller() != state[FACTORY] {
        host.revert(&NOT_FACTORY);
    }
    if state[DEPLOYED] != 0 {
        host.revert(&ALREADY_DEPLOYED);
    }
    state[DEPLOYED] = 1;
    host.store(&STATE_SLOT, &state);

    // No salt: the target's address derives from this child and its nonce,
    // and from nothing in `buffer`.
    let end = 32 + input_len;
    buffer[..32].copy_from_slice(&head[..32]);
    host.call_data_copy(&mut buffer[32..end], input_start);
    match host.instantiate(&buffer[..end], None) {
        Some(address) => {
            let mut word = [0u8; 32];
            word[12..].copy_from_slice(&address);
            host.answer(&word);
        }
        None => {
            let len = host.return_data_size();
            host.return_data_copy(&mut buffer[..len]);
            host.revert(&buffer[..len]);
        }
    }
}

#[cfg(not(target_arch = "riscv64"))]
fn main() {}

/// The contract's entry points.
#[cfg(target_arch = "riscv64")]
mod entry {
    use super::{BUFFER_LEN, construct};
    use contract_host::Chain;
    use core::ptr::addr_of_mut;

    static mut BUFFER: [u8; BUFFER_LEN] = [0; BUFFER_LEN];

    #[polkavm_derive::polkavm_export]
    extern "C" fn deploy() {
        construct(&Chain);
    }

    #[polkavm_derive::polkavm_export]
    extern "C" fn call() {
        // SAFETY: a call runs alone on a fresh instance, so nothing else
        // holds this buffer.
        super::call(&Chain, unsafe { &mut *addr_of_mut!(BUFFER) });
    }
}

#[cfg(test)]
mod tests {
    use super::{BUFFER_LEN, call, construct};
    use contract_host::Host;
    use contract_host::mock::{
        Instantiation, Mock, MockHostBuilder, ReturnFlags, ReturnValue, U256,
    };

    const FACTORY: [u8; 20] = [0xFA; 20];
    const INTRUDER: [u8; 20] = [0xBB; 20];
    const TARGET: [u8; 20] = [0x77; 20];
    const CODE_HASH: [u8; 32] = [0xC0; 32];

    type Storage = Vec<(Vec<u8>, Vec<u8>)>;

    /// The first four bytes of `signature`'s hash, by the mock host's keccak.
    fn selector(signature: &str) -> [u8; 4] {
        let hash = MockHostBuilder::new()
            .build()
            .keccak256(signature.as_bytes());
        [hash[0], hash[1], hash[2], hash[3]]
    }

    fn word(value: usize) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[24..].copy_from_slice(&(value as u64).to_be_bytes());
        word
    }

    fn word_addr(address: [u8; 20]) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    /// `deploy(CODE_HASH, input)` as an ABI encoder lays it out.
    fn deploy_calldata(input: &[u8]) -> Vec<u8> {
        let mut calldata = [
            &selector("deploy(bytes32,bytes)")[..],
            &CODE_HASH,
            &word(0x40),
            &word(input.len()),
            input,
        ]
        .concat();
        calldata.resize(4 + 96 + input.len().div_ceil(32) * 32, 0);
        calldata
    }

    /// The storage of a child the factory just instantiated.
    fn child_from_factory() -> Storage {
        let mock = MockHostBuilder::new().caller(FACTORY).build();
        construct(&mock);
        mock.storage_dump()
    }

    /// A call from `caller` with `calldata` to a child holding `storage`,
    /// with a mocked instantiate result staged.
    fn calling(storage: Storage, caller: [u8; 20], calldata: Vec<u8>) -> Mock {
        Mock::new(
            MockHostBuilder::new()
                .caller(caller)
                .calldata(calldata)
                .storage(storage)
                .mock_instantiate(TARGET, vec![])
                .build(),
        )
    }

    /// Run the call over scratch space that is not zeroed.
    fn run(mock: &Mock) {
        call(mock, &mut vec![0xA5; BUFFER_LEN]);
    }

    fn returned(word: [u8; 32]) -> Option<ReturnValue> {
        Some(ReturnValue {
            flags: ReturnFlags::empty(),
            data: word.to_vec(),
        })
    }

    /// The data `mock`'s call reverts with.
    fn revert_data(mock: &Mock) -> Vec<u8> {
        mock.host.expect_revert(|| run(mock)).data
    }

    #[test]
    fn constructor_pins_instantiating_factory() {
        let storage = child_from_factory();
        assert_eq!(storage, vec![(vec![0u8; 32], word_addr(FACTORY).to_vec())]);

        let mock = calling(storage, INTRUDER, selector("getFactory()").to_vec());
        run(&mock);
        assert_eq!(mock.host.take_return_value(), returned(word_addr(FACTORY)));
    }

    #[test]
    fn deploy_returns_created_address_exactly_once() {
        let first = calling(child_from_factory(), FACTORY, deploy_calldata(&[1, 2, 3]));
        run(&first);
        assert_eq!(first.host.take_return_value(), returned(word_addr(TARGET)));

        let mut spent = word_addr(FACTORY);
        spent[11] = 1;
        let storage = first.host.storage_dump();
        assert_eq!(storage, vec![(vec![0u8; 32], spent.to_vec())]);

        // The single CREATE1 is spent, even for the factory.
        let second = calling(storage, FACTORY, deploy_calldata(&[]));
        assert_eq!(revert_data(&second), selector("AlreadyDeployed()"));
    }

    #[test]
    fn deploy_rejects_non_factory_callers() {
        let mock = calling(child_from_factory(), INTRUDER, deploy_calldata(&[]));
        assert_eq!(revert_data(&mock), selector("NotFactory()"));
    }

    #[test]
    fn deploy_instantiates_the_code_hash_and_input_without_a_salt() {
        for input in [vec![], vec![1, 2, 3], vec![0xEE; 33]] {
            let mock = calling(child_from_factory(), FACTORY, deploy_calldata(&input));
            run(&mock);
            assert_eq!(
                mock.take_instantiations(),
                vec![Instantiation {
                    input: [&CODE_HASH[..], &input].concat(),
                    salt: None,
                }]
            );
        }
    }

    #[test]
    fn deploy_reads_the_input_from_where_its_offset_points() {
        // An unused word between the head and the input, and bytes after it.
        let calldata = [
            &selector("deploy(bytes32,bytes)")[..],
            &CODE_HASH,
            &word(0x60),
            &[0xFF; 32],
            &word(2),
            &[0xAB, 0xCD, 0xFF, 0xFF],
        ]
        .concat();
        let mock = calling(child_from_factory(), FACTORY, calldata);
        run(&mock);
        assert_eq!(
            mock.take_instantiations()[0].input,
            [&CODE_HASH[..], &[0xAB, 0xCD]].concat()
        );
    }

    #[test]
    fn a_failed_target_constructor_reverts() {
        let mock = Mock::new(
            MockHostBuilder::new()
                .caller(FACTORY)
                .calldata(deploy_calldata(&[]))
                .storage(child_from_factory())
                .build(),
        );
        assert_eq!(revert_data(&mock), vec![]);
    }

    #[test]
    fn calldata_that_fits_no_method_reverts_empty() {
        let deploy = selector("deploy(bytes32,bytes)");
        let offset_past_the_end = [&deploy[..], &CODE_HASH, &word(0x41), &word(0)].concat();
        let length_past_the_end =
            [&deploy[..], &CODE_HASH, &word(0x40), &word(3), &[1, 2]].concat();
        for calldata in [
            vec![],
            deploy[..3].to_vec(),
            selector("deploy(bytes32,bytes32,bytes)").to_vec(),
            deploy_calldata(&[])[..4 + 63].to_vec(),
            offset_past_the_end,
            length_past_the_end,
        ] {
            let mock = calling(child_from_factory(), FACTORY, calldata);
            assert_eq!(revert_data(&mock), vec![]);
        }
    }

    #[test]
    fn value_sent_to_the_constructor_or_a_call_reverts_empty() {
        let constructor = MockHostBuilder::new()
            .caller(FACTORY)
            .value_transferred(U256::from(1))
            .build();
        let reverted = constructor.expect_revert(|| construct(&constructor));
        assert_eq!(reverted.data, vec![]);

        let mock = Mock::new(
            MockHostBuilder::new()
                .caller(FACTORY)
                .calldata(selector("getFactory()").to_vec())
                .storage(child_from_factory())
                .value_transferred(U256::from(1))
                .build(),
        );
        assert_eq!(revert_data(&mock), vec![]);
    }
}
