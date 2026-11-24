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
//!
//! **Constructor** — `(bytes32 childCodeHash)`: the keccak-256 of the
//! committed child deployer blob, which every derived address commits to.
//! The caller becomes the owner. Input shorter than one word reverts.
//!
//! **Storage** — slot 0 holds the owner, right-aligned in its word; slot 1
//! holds the child code hash.
//!
//! **Methods**
//!
//! - `deploy(bytes32 salt, bytes32 codeHash, bytes input) returns (address)`
//!   `0xd76fad23` deploys pre-uploaded `codeHash` with constructor calldata
//!   `input` at `predict(salt)`. It reverts `NotOwner()` unless the caller
//!   is the owner. Each salt is usable exactly once, forever: the child
//!   permanently occupies its CREATE2 slot, so instantiating it again fails.
//!   A failed child instantiation and a failed target constructor bubble
//!   their revert data unchanged. A child that answers with anything but
//!   one word holding an address reverts `ChildCallFailed()`. Emits
//!   `Deployed(bytes32 indexed salt, address addr, bytes32 codeHash)`.
//! - `predict(bytes32 salt) returns (address)` `0x0e787cce`: the address
//!   `deploy(salt, ..)` will produce, or did.
//! - `getOwner() returns (address)` `0x893d20e8`.
//! - `setOwner(address newOwner)` `0x13af4035` reverts `NotOwner()` unless
//!   the caller is the owner. Returns nothing.
//! - `getChildCodeHash() returns (bytes32)` `0x0d9ca5e2`.
//!
//! Arguments are read as the ABI lays them out, starting after the selector.
//! An address is the low 20 bytes of its word; the other 12 are not read.
//! `input` is found through its offset word, and only the low 8 bytes of
//! that word and of the length word are read. Bytes past a method's
//! arguments are ignored. Arguments are read before the caller is checked.
//!
//! A call with value, with fewer than 4 bytes, with an unknown selector, or
//! with calldata too short to hold its arguments reverts with empty data. So
//! does a constructor sent value.

#![cfg_attr(target_arch = "riscv64", no_std, no_main)]

// polkavm-linker gives a contract an 8 KiB stack unless it asks for more;
// 128 KiB is resolc's default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

use contract_host::abi::{SELECTOR_LEN, bytes_argument, keccak, selector};
use contract_host::{Host, reject_value};

/// pallet-revive caps calldata and return data at this many bytes each.
const MAX_DATA: usize = 128 * 1024;
/// What the child's `deploy(bytes32,bytes)` calldata holds before the
/// constructor input: selector, code hash, offset word, length word.
const CHILD_HEAD_LEN: usize = 4 + 3 * 32;
/// The child's calldata for the longest constructor input a call can carry.
/// A failed sub-call's return data fits too.
pub const BUFFER_LEN: usize = CHILD_HEAD_LEN + MAX_DATA;

const OWNER_SLOT: [u8; 32] = slot(0);
const CHILD_CODE_HASH_SLOT: [u8; 32] = slot(1);

const fn slot(index: u8) -> [u8; 32] {
    let mut key = [0u8; 32];
    key[31] = index;
    key
}

const DEPLOY: [u8; 4] = selector(b"deploy(bytes32,bytes32,bytes)");
const PREDICT: [u8; 4] = selector(b"predict(bytes32)");
const GET_OWNER: [u8; 4] = selector(b"getOwner()");
const SET_OWNER: [u8; 4] = selector(b"setOwner(address)");
const GET_CHILD_CODE_HASH: [u8; 4] = selector(b"getChildCodeHash()");

const NOT_OWNER: [u8; 4] = selector(b"NotOwner()");
const CHILD_CALL_FAILED: [u8; 4] = selector(b"ChildCallFailed()");

/// The child's `deploy(bytes32 codeHash, bytes input)`.
const CHILD_DEPLOY: [u8; 4] = selector(b"deploy(bytes32,bytes)");
/// Topic 0 of `Deployed(bytes32 indexed salt, address addr, bytes32 codeHash)`.
const DEPLOYED: [u8; 32] = keccak(b"Deployed(bytes32,address,bytes32)");

/// The constructor: the caller becomes the owner, and the calldata's one
/// word the child code hash.
pub fn construct<H: Host>(host: &H) {
    reject_value(host);
    let mut child_code_hash = [0u8; 32];
    if host.call_data_size() < child_code_hash.len() {
        host.revert(&[]);
    }
    host.call_data_copy(&mut child_code_hash, 0);
    host.store(&OWNER_SLOT, &address_word(&host.caller()));
    host.store(&CHILD_CODE_HASH_SLOT, &child_code_hash);
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
        PREDICT => {
            let salt: [u8; 32] = arguments(host, size);
            let child = create2_address(
                host,
                &host.address(),
                &salt,
                &host.load(&CHILD_CODE_HASH_SLOT),
            );
            host.answer(&address_word(&create1_address(host, &child)));
        }
        GET_OWNER => host.answer(&address_word(&owner(host))),
        SET_OWNER => {
            let new_owner: [u8; 32] = arguments(host, size);
            require_owner(host);
            host.store(&OWNER_SLOT, &address_word(&new_owner[12..]));
            host.answer(&[]);
        }
        GET_CHILD_CODE_HASH => host.answer(&host.load(&CHILD_CODE_HASH_SLOT)),
        _ => host.revert(&[]),
    }
}

/// `deploy(bytes32 salt, bytes32 codeHash, bytes input)`, the calldata being
/// `size` bytes.
fn deploy<H: Host>(host: &H, size: usize, buffer: &mut [u8]) {
    let head: [u8; 96] = arguments(host, size);
    let Some((input_start, input_len)) = bytes_argument(host, size, &head[64..]) else {
        host.revert(&[])
    };
    require_owner(host);
    let mut salt = [0u8; 32];
    salt.copy_from_slice(&head[..32]);
    let code_hash = &head[32..64];

    // The child takes no constructor input, so its address commits only to
    // (factory, child blob, salt).
    let Some(child) = host.instantiate(&host.load(&CHILD_CODE_HASH_SLOT), Some(&salt)) else {
        bubble_revert(host, buffer)
    };

    // Have the child CREATE1 the target: `deploy(codeHash, input)`, with
    // `input` right after the two head words and zero-padded to a whole word.
    let input_end = CHILD_HEAD_LEN + input_len;
    let padded_end = CHILD_HEAD_LEN + input_len.div_ceil(32) * 32;
    buffer[..4].copy_from_slice(&CHILD_DEPLOY);
    buffer[4..36].copy_from_slice(code_hash);
    buffer[36..68].copy_from_slice(&length_word(64));
    buffer[68..CHILD_HEAD_LEN].copy_from_slice(&length_word(input_len));
    host.call_data_copy(&mut buffer[CHILD_HEAD_LEN..input_end], input_start);
    buffer[input_end..padded_end].fill(0);
    if !host.call(&child, &buffer[..padded_end]) {
        bubble_revert(host, buffer);
    }

    let mut target = [0u8; 32];
    if host.return_data_size() != target.len() {
        host.revert(&CHILD_CALL_FAILED);
    }
    host.return_data_copy(&mut target);
    if target[..12] != [0u8; 12] {
        host.revert(&CHILD_CALL_FAILED);
    }

    let mut data = [0u8; 64];
    data[..32].copy_from_slice(&target);
    data[32..].copy_from_slice(code_hash);
    host.emit(&[DEPLOYED, salt], &data);
    host.answer(&target);
}

/// `keccak256(0xff ++ deployer ++ salt ++ init_code_hash)[12..]`, as
/// pallet-revive derives a salted address. The child takes no constructor
/// input, so its init-code hash is exactly the child code hash.
pub fn create2_address<H: Host>(
    host: &H,
    deployer: &[u8; 20],
    salt: &[u8; 32],
    init_code_hash: &[u8; 32],
) -> [u8; 20] {
    let mut preimage = [0u8; 85];
    preimage[0] = 0xff;
    preimage[1..21].copy_from_slice(deployer);
    preimage[21..53].copy_from_slice(salt);
    preimage[53..85].copy_from_slice(init_code_hash);
    keccak_address(host, &preimage)
}

/// `keccak256(rlp([deployer, 1]))[12..]`, as pallet-revive derives an
/// unsalted address: revive starts a contract's nonce at 1, so the child's
/// one instantiation happens at nonce 1. RLP of a 20-byte string and the
/// integer 1 is fixed-shape: `0xd6 0x94 <20 bytes> 0x01`.
pub fn create1_address<H: Host>(host: &H, deployer: &[u8; 20]) -> [u8; 20] {
    let mut preimage = [0u8; 23];
    preimage[0] = 0xd6; // list, payload length 22
    preimage[1] = 0x94; // string, length 20
    preimage[2..22].copy_from_slice(deployer);
    preimage[22] = 0x01; // nonce 1
    keccak_address(host, &preimage)
}

fn keccak_address<H: Host>(host: &H, preimage: &[u8]) -> [u8; 20] {
    let mut address = [0u8; 20];
    address.copy_from_slice(&host.keccak256(preimage)[12..]);
    address
}

fn owner<H: Host>(host: &H) -> [u8; 20] {
    let mut owner = [0u8; 20];
    owner.copy_from_slice(&host.load(&OWNER_SLOT)[12..]);
    owner
}

fn require_owner<H: Host>(host: &H) {
    if host.caller() != owner(host) {
        host.revert(&NOT_OWNER);
    }
}

/// End the call reverting with the failed sub-call's return data.
fn bubble_revert<H: Host>(host: &H, buffer: &mut [u8]) -> ! {
    let len = host.return_data_size();
    host.return_data_copy(&mut buffer[..len]);
    host.revert(&buffer[..len])
}

/// The first `N` bytes of arguments. Reverts when the calldata of `size`
/// bytes holds fewer.
fn arguments<H: Host, const N: usize>(host: &H, size: usize) -> [u8; N] {
    if size < SELECTOR_LEN + N {
        host.revert(&[]);
    }
    let mut arguments = [0u8; N];
    host.call_data_copy(&mut arguments, SELECTOR_LEN);
    arguments
}

/// `value` as an ABI offset or length word.
fn length_word(value: usize) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[24..].copy_from_slice(&(value as u64).to_be_bytes());
    word
}

/// The 20 bytes of `address` right-aligned in a word: an ABI `address`, and
/// the owner as stored.
fn address_word(address: &[u8]) -> [u8; 32] {
    let mut word = [0u8; 32];
    word[12..].copy_from_slice(address);
    word
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
    use super::{BUFFER_LEN, call, construct, create1_address, create2_address};
    use contract_host::Host;
    use contract_host::mock::{Instantiation, Mock, MockHost, MockHostBuilder, U256};

    const OWNER: [u8; 20] = [0xAA; 20];
    const INTRUDER: [u8; 20] = [0xBB; 20];
    const FACTORY_ADDR: [u8; 20] = [0xFA; 20];
    const CHILD: [u8; 20] = [0xC4; 20];
    const TARGET: [u8; 20] = [0x77; 20];
    const CHILD_CODE_HASH: [u8; 32] = [0xC0; 32];
    const SALT: [u8; 32] = [0x5A; 32];
    const TARGET_CODE_HASH: [u8; 32] = [0x11; 32];

    type Storage = Vec<(Vec<u8>, Vec<u8>)>;

    fn host() -> MockHost {
        MockHostBuilder::new().build()
    }

    /// The first four bytes of `signature`'s hash, by the mock host's keccak.
    fn selector(signature: &str) -> [u8; 4] {
        let hash = host().keccak256(signature.as_bytes());
        [hash[0], hash[1], hash[2], hash[3]]
    }

    fn word(value: usize) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[24..].copy_from_slice(&(value as u64).to_be_bytes());
        word
    }

    fn address_word(address: [u8; 20]) -> Vec<u8> {
        let mut word = vec![0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    /// `signature`'s selector followed by `arguments`.
    fn calldata(signature: &str, arguments: &[&[u8]]) -> Vec<u8> {
        [&selector(signature)[..], &arguments.concat()].concat()
    }

    /// `input` as the tail of a `bytes` argument: its length word, then the
    /// bytes zero-padded to a whole word.
    fn bytes_tail(input: &[u8]) -> Vec<u8> {
        let mut tail = [&word(input.len())[..], input].concat();
        tail.resize(32 + input.len().div_ceil(32) * 32, 0);
        tail
    }

    /// `deploy(SALT, TARGET_CODE_HASH, input)` as an ABI encoder lays it out.
    fn deploy_calldata(input: &[u8]) -> Vec<u8> {
        calldata(
            "deploy(bytes32,bytes32,bytes)",
            &[&SALT, &TARGET_CODE_HASH, &word(0x60), &bytes_tail(input)],
        )
    }

    /// The storage of a factory `OWNER` just deployed over `CHILD_CODE_HASH`.
    fn deployed_factory() -> Storage {
        let mock = MockHostBuilder::new()
            .caller(OWNER)
            .calldata(CHILD_CODE_HASH.to_vec())
            .build();
        construct(&mock);
        mock.storage_dump()
    }

    /// A call from `caller` with `calldata` to a factory holding `storage`,
    /// whose child instantiates at `CHILD` and answers `child_answer`.
    fn calling_with(
        storage: Storage,
        caller: [u8; 20],
        calldata: Vec<u8>,
        child_answer: Result<Vec<u8>, ()>,
    ) -> Mock {
        Mock::new(
            MockHostBuilder::new()
                .caller(caller)
                .address(FACTORY_ADDR)
                .calldata(calldata)
                .storage(storage)
                .mock_instantiate(CHILD, vec![])
                .mock_call(CHILD, child_answer)
                .build(),
        )
    }

    /// `calling_with` a freshly deployed factory whose child answers `TARGET`.
    fn calling(caller: [u8; 20], calldata: Vec<u8>) -> Mock {
        calling_with(
            deployed_factory(),
            caller,
            calldata,
            Ok(address_word(TARGET)),
        )
    }

    /// Run the call over scratch space that is not zeroed.
    fn run(mock: &Mock) {
        call(mock, &mut vec![0xA5; BUFFER_LEN]);
    }

    /// The data `mock`'s call returns.
    fn return_data(mock: &Mock) -> Vec<u8> {
        run(mock);
        mock.host.take_return_value().unwrap().data
    }

    /// The data `mock`'s call reverts with.
    fn revert_data(mock: &Mock) -> Vec<u8> {
        mock.host.expect_revert(|| run(mock)).data
    }

    #[test]
    fn constructor_pins_owner_and_child_code_hash() {
        let mut slots = deployed_factory();
        slots.sort();
        assert_eq!(
            slots,
            vec![
                (word(0).to_vec(), address_word(OWNER)),
                (word(1).to_vec(), CHILD_CODE_HASH.to_vec()),
            ]
        );

        let get_owner = calling(INTRUDER, calldata("getOwner()", &[]));
        assert_eq!(return_data(&get_owner), address_word(OWNER));
        let get_child_code_hash = calling(INTRUDER, calldata("getChildCodeHash()", &[]));
        assert_eq!(return_data(&get_child_code_hash), CHILD_CODE_HASH);
    }

    #[test]
    fn constructor_input_shorter_than_one_word_reverts_empty() {
        let mock = MockHostBuilder::new()
            .caller(OWNER)
            .calldata(vec![0xC0; 31])
            .build();
        assert_eq!(mock.expect_revert(|| construct(&mock)).data, vec![]);
    }

    #[test]
    fn deploy_spawns_child_then_delegates_the_create1() {
        let mock = calling(OWNER, deploy_calldata(&[0xAB, 0xCD]));
        assert_eq!(return_data(&mock), address_word(TARGET));

        // The child is instantiated from its code hash alone, under the salt.
        assert_eq!(
            mock.take_instantiations(),
            vec![Instantiation {
                input: CHILD_CODE_HASH.to_vec(),
                salt: Some(SALT),
            }]
        );

        // Exactly one call was made: child.deploy(code_hash, input).
        assert_eq!(
            mock.host.take_recorded_calls(),
            vec![(
                CHILD,
                calldata(
                    "deploy(bytes32,bytes)",
                    &[&TARGET_CODE_HASH, &word(0x40), &bytes_tail(&[0xAB, 0xCD])],
                )
            )]
        );

        // Deployed event: topic0 + indexed salt, then (address, code_hash) data.
        assert_eq!(
            mock.host.events(),
            vec![(
                vec![host().keccak256(b"Deployed(bytes32,address,bytes32)"), SALT],
                [address_word(TARGET), TARGET_CODE_HASH.to_vec()].concat(),
            )]
        );
    }

    #[test]
    fn deploy_pads_the_child_calldata_to_whole_words() {
        for input in [vec![], vec![0xEE; 32], vec![0xEE; 33]] {
            let mock = calling(OWNER, deploy_calldata(&input));
            run(&mock);
            assert_eq!(
                mock.host.take_recorded_calls()[0].1,
                calldata(
                    "deploy(bytes32,bytes)",
                    &[&TARGET_CODE_HASH, &word(0x40), &bytes_tail(&input)],
                )
            );
        }
    }

    #[test]
    fn deploy_reads_the_input_from_where_its_offset_points() {
        // An unused word between the head and the input, and bytes after it.
        let mock = calling(
            OWNER,
            calldata(
                "deploy(bytes32,bytes32,bytes)",
                &[
                    &SALT,
                    &TARGET_CODE_HASH,
                    &word(0x80),
                    &[0xFF; 32],
                    &word(2),
                    &[0xAB, 0xCD, 0xFF, 0xFF],
                ],
            ),
        );
        run(&mock);
        assert_eq!(
            mock.host.take_recorded_calls()[0].1,
            calldata(
                "deploy(bytes32,bytes)",
                &[&TARGET_CODE_HASH, &word(0x40), &bytes_tail(&[0xAB, 0xCD])],
            )
        );
    }

    #[test]
    fn deploy_rejects_non_owner() {
        let deploy = calling(INTRUDER, deploy_calldata(&[]));
        assert_eq!(revert_data(&deploy), selector("NotOwner()"));

        let set_owner = calling(
            INTRUDER,
            calldata("setOwner(address)", &[&address_word(INTRUDER)]),
        );
        assert_eq!(revert_data(&set_owner), selector("NotOwner()"));
    }

    #[test]
    fn deploy_reverts_when_the_child_cannot_be_instantiated() {
        let mock = Mock::new(
            MockHostBuilder::new()
                .caller(OWNER)
                .calldata(deploy_calldata(&[]))
                .storage(deployed_factory())
                .build(),
        );
        assert_eq!(revert_data(&mock), vec![]);
    }

    #[test]
    fn deploy_reverts_when_the_child_call_fails() {
        let mock = calling_with(deployed_factory(), OWNER, deploy_calldata(&[]), Err(()));
        assert_eq!(revert_data(&mock), vec![]);
    }

    #[test]
    fn deploy_rejects_a_child_answer_that_is_not_one_address_word() {
        let mut dirty = address_word(TARGET);
        dirty[11] = 1;
        for answer in [
            vec![],
            address_word(TARGET)[..31].to_vec(),
            [address_word(TARGET), vec![0]].concat(),
            dirty,
        ] {
            let mock = calling_with(deployed_factory(), OWNER, deploy_calldata(&[]), Ok(answer));
            assert_eq!(revert_data(&mock), selector("ChildCallFailed()"));
        }
    }

    #[test]
    fn set_owner_transfers_control() {
        let set_owner = calling(
            OWNER,
            calldata("setOwner(address)", &[&address_word(INTRUDER)]),
        );
        assert_eq!(return_data(&set_owner), vec![]);

        let get_owner = calling_with(
            set_owner.host.storage_dump(),
            OWNER,
            calldata("getOwner()", &[]),
            Ok(vec![]),
        );
        assert_eq!(return_data(&get_owner), address_word(INTRUDER));
    }

    #[test]
    fn set_owner_reads_the_address_from_the_low_20_bytes_of_its_word() {
        let mut argument = [0xFF; 32];
        argument[12..].copy_from_slice(&INTRUDER);
        let mock = calling(OWNER, calldata("setOwner(address)", &[&argument]));
        run(&mock);
        assert_eq!(
            mock.host.get_raw_storage(&word(0)),
            Some(address_word(INTRUDER))
        );
    }

    #[test]
    fn calldata_that_fits_no_method_reverts_empty() {
        let deploy = "deploy(bytes32,bytes32,bytes)";
        let offset_past_the_end = [&SALT, &TARGET_CODE_HASH, &word(0x61), &word(0)];
        let length_past_the_end: [&[u8]; 5] =
            [&SALT, &TARGET_CODE_HASH, &word(0x60), &word(3), &[1, 2]];
        for calldata in [
            vec![],
            selector("getOwner()")[..3].to_vec(),
            calldata("deploy(bytes32,bytes)", &[]),
            deploy_calldata(&[])[..4 + 95].to_vec(),
            calldata(deploy, &offset_past_the_end.map(|word| &word[..])),
            calldata(deploy, &length_past_the_end),
            calldata("predict(bytes32)", &[&SALT[..31]]),
            calldata("setOwner(address)", &[&address_word(INTRUDER)[..31]]),
        ] {
            let mock = calling(OWNER, calldata);
            assert_eq!(revert_data(&mock), vec![]);
        }
    }

    #[test]
    fn value_sent_to_the_constructor_or_a_call_reverts_empty() {
        let constructor = MockHostBuilder::new()
            .caller(OWNER)
            .calldata(CHILD_CODE_HASH.to_vec())
            .value_transferred(U256::from(1))
            .build();
        let reverted = constructor.expect_revert(|| construct(&constructor));
        assert_eq!(reverted.data, vec![]);

        let mock = Mock::new(
            MockHostBuilder::new()
                .caller(OWNER)
                .calldata(calldata("getOwner()", &[]))
                .storage(deployed_factory())
                .value_transferred(U256::from(1))
                .build(),
        );
        assert_eq!(revert_data(&mock), vec![]);
    }

    // ─── Address derivation, checked against independent fixtures ─────────

    /// pallet-revive's own test vector (address.rs `create1_works`):
    /// `create1([0x01; 20], nonce 1) == c851da37e4e8d3a20d8d56be2963934b4ad71c3b`.
    #[test]
    fn create1_matches_pallet_revive_test_vector() {
        let expected = [
            0xc8, 0x51, 0xda, 0x37, 0xe4, 0xe8, 0xd3, 0xa2, 0x0d, 0x8d, 0x56, 0xbe, 0x29, 0x63,
            0x93, 0x4b, 0x4a, 0xd7, 0x1c, 0x3b,
        ];
        assert_eq!(create1_address(&host(), &[0x01; 20]), expected);
    }

    /// EIP-1014 example 4: deployer 0x00000000000000000000000000000000deadbeef,
    /// salt 0x…cafebabe, init_code 0xdeadbeef →
    /// 0x60f3f640a8508fC6a86d45DF051962668E1e8AC7.
    #[test]
    fn create2_matches_eip1014_test_vector() {
        let mut deployer = [0u8; 20];
        deployer[16..].copy_from_slice(&[0xde, 0xad, 0xbe, 0xef]);
        let mut salt = [0u8; 32];
        salt[28..].copy_from_slice(&[0xca, 0xfe, 0xba, 0xbe]);
        let init_code_hash = host().keccak256(&[0xde, 0xad, 0xbe, 0xef]);

        let expected = [
            0x60, 0xf3, 0xf6, 0x40, 0xa8, 0x50, 0x8f, 0xc6, 0xa8, 0x6d, 0x45, 0xdf, 0x05, 0x19,
            0x62, 0x66, 0x8e, 0x1e, 0x8a, 0xc7,
        ];
        assert_eq!(
            create2_address(&host(), &deployer, &salt, &init_code_hash),
            expected
        );
    }

    /// `predict` is the composition of the two derivations above.
    #[test]
    fn predict_composes_create2_then_create1() {
        let mock = calling(INTRUDER, calldata("predict(bytes32)", &[&SALT]));
        let child = create2_address(&host(), &FACTORY_ADDR, &SALT, &CHILD_CODE_HASH);
        assert_eq!(
            return_data(&mock),
            address_word(create1_address(&host(), &child))
        );
    }
}
