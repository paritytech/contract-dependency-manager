//! EIP-1967 proxy: the stable on-chain address of an upgradeable CDM
//! contract. The registry and the resolver are each deployed behind one.
//!
//! It holds no logic of its own: every call is forwarded by tail
//! delegate-call to the implementation stored at the EIP-1967 implementation
//! slot, so the implementation's methods run against this proxy's storage.
//! Upgrades go through the implementation's `setCode`, which rewrites that
//! slot; the proxy itself never changes.
//!
//! **Constructor** — `(address implementation, address admin)` as two ABI
//! words, stored at the EIP-1967 implementation and admin slots
//! (`contract_registry_core::slots`). An address is the low 20 bytes of its
//! word; the other 12 are not read. Input shorter than two words reverts.
//!
//! The admin is an argument and not the caller: deployed through the CREATE3
//! factory, the caller is the single-use child deployer, which could never
//! act as admin. A CREATE3 address does not commit to constructor input, so
//! passing the admin costs nothing.
//!
//! **Calls** — the calldata goes to the implementation unchanged, and the
//! implementation's return data or revert data comes back unchanged. The
//! proxy has no methods, so it takes no selector from the implementation.
//!
//! Neither the constructor nor a call accepts value. Every revert the proxy
//! raises itself carries no data.

#![cfg_attr(target_arch = "riscv64", no_std, no_main)]

use contract_host::{Host, reject_value};
use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT};

/// pallet-revive caps calldata and return data at this many bytes each.
pub const MAX_DATA: usize = 128 * 1024;

/// The constructor: pins the implementation and the admin from the calldata.
pub fn construct<H: Host>(host: &H) {
    reject_value(host);
    if host.call_data_size() < 64 {
        host.revert(&[]);
    }
    let mut implementation = [0u8; 32];
    let mut admin = [0u8; 32];
    host.call_data_copy(&mut implementation[12..], 12);
    host.call_data_copy(&mut admin[12..], 44);
    host.store(&IMPLEMENTATION_SLOT, &implementation);
    host.store(&ADMIN_SLOT, &admin);
}

/// Every call lands here: forward the calldata to the implementation and end
/// with its result. `buffer` is scratch space of [`MAX_DATA`] bytes, used for
/// the calldata and then for the return data.
pub fn fallback<H: Host>(host: &H, buffer: &mut [u8]) {
    reject_value(host);
    let len = host.call_data_size();
    host.call_data_copy(&mut buffer[..len], 0);

    let word = host.load(&IMPLEMENTATION_SLOT);
    let mut implementation = [0u8; 20];
    implementation.copy_from_slice(&word[12..]);

    let ok = host.delegate_call(&implementation, &buffer[..len]);
    // On chain a tail call that ran never returns here.
    let len = host.return_data_size();
    host.return_data_copy(&mut buffer[..len]);
    if !ok {
        host.revert(&buffer[..len]);
    }
    host.answer(&buffer[..len]);
}

#[cfg(not(target_arch = "riscv64"))]
fn main() {}

/// The contract's entry points.
#[cfg(target_arch = "riscv64")]
mod entry {
    use super::{MAX_DATA, construct, fallback};
    use contract_host::Chain;
    use core::ptr::addr_of_mut;

    static mut BUFFER: [u8; MAX_DATA] = [0; MAX_DATA];

    #[polkavm_derive::polkavm_export]
    extern "C" fn deploy() {
        construct(&Chain);
    }

    #[polkavm_derive::polkavm_export]
    extern "C" fn call() {
        // SAFETY: a call runs alone on a fresh instance, so nothing else
        // holds this buffer.
        fallback(&Chain, unsafe { &mut *addr_of_mut!(BUFFER) });
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_DATA, construct, fallback};
    use contract_host::mock::{MockHost, MockHostBuilder, ReturnFlags, ReturnValue, U256};
    use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT};

    const DEPLOYER: [u8; 20] = [0xAA; 20];
    const ADMIN: [u8; 20] = [0xAD; 20];
    const IMPL: [u8; 20] = [0x1C; 20];

    /// A 20-byte address right-aligned in a 32-byte word: an ABI `address`,
    /// and the layout solc uses for the EIP-1967 slots.
    fn word_addr(address: [u8; 20]) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    /// A host about to run the constructor with `input`, sent by `DEPLOYER`.
    fn constructing(input: Vec<u8>) -> MockHost {
        MockHostBuilder::new()
            .caller(DEPLOYER)
            .calldata(input)
            .build()
    }

    /// A proxy constructed over `IMPL` and `ADMIN`, with `calldata` staged
    /// for the fallback to forward.
    fn deployed_proxy(calldata: Vec<u8>) -> MockHost {
        let constructor = constructing([word_addr(IMPL), word_addr(ADMIN)].concat());
        construct(&constructor);
        MockHostBuilder::new()
            .calldata(calldata)
            .storage(constructor.storage_dump())
            .build()
    }

    /// Run the fallback over scratch space that is not zeroed.
    fn run(mock: &MockHost) {
        fallback(mock, &mut vec![0xA5; MAX_DATA]);
    }

    fn returned(data: Vec<u8>) -> Option<ReturnValue> {
        Some(ReturnValue {
            flags: ReturnFlags::empty(),
            data,
        })
    }

    const EMPTY_REVERT: ReturnValue = ReturnValue {
        flags: ReturnFlags::REVERT,
        data: vec![],
    };

    #[test]
    fn constructor_pins_implementation_and_admin_slots() {
        let mock = constructing([word_addr(IMPL), word_addr(ADMIN)].concat());
        construct(&mock);

        assert_eq!(
            mock.get_raw_storage(&IMPLEMENTATION_SLOT),
            Some(word_addr(IMPL).to_vec())
        );
        assert_eq!(
            mock.get_raw_storage(&ADMIN_SLOT),
            Some(word_addr(ADMIN).to_vec())
        );
    }

    #[test]
    fn constructor_reads_each_address_from_the_low_20_bytes_of_its_word() {
        let mut input = [0xFF; 64];
        input[12..32].copy_from_slice(&IMPL);
        input[44..].copy_from_slice(&ADMIN);
        let mock = constructing(input.to_vec());
        construct(&mock);

        assert_eq!(
            mock.get_raw_storage(&IMPLEMENTATION_SLOT),
            Some(word_addr(IMPL).to_vec())
        );
        assert_eq!(
            mock.get_raw_storage(&ADMIN_SLOT),
            Some(word_addr(ADMIN).to_vec())
        );
    }

    #[test]
    fn constructor_input_shorter_than_two_words_reverts_empty() {
        let mock = constructing(vec![0x11; 63]);
        assert_eq!(mock.expect_revert(|| construct(&mock)), EMPTY_REVERT);
    }

    #[test]
    fn fallback_forwards_calldata_and_returns_success_payload() {
        // Arbitrary selector-shaped calldata; the proxy must not interpret it.
        let calldata: Vec<u8> = [0xbf, 0x40, 0xfa, 0xc1]
            .into_iter()
            .chain([0x11; 64])
            .collect();
        let mock = deployed_proxy(calldata.clone());
        let payload = vec![0xEE; 96];
        mock.mock_call(IMPL, Ok(payload.clone()));

        run(&mock);

        assert_eq!(mock.take_recorded_calls(), vec![(IMPL, calldata)]);
        assert_eq!(mock.take_return_value(), returned(payload));
    }

    #[test]
    fn fallback_bubbles_callee_revert() {
        let calldata = vec![1, 2, 3, 4];
        let mock = deployed_proxy(calldata.clone());
        // MockHost's `Err(())` models a revert with no payload, so the bubbled
        // revert data must be empty.
        mock.mock_call(IMPL, Err(()));

        assert_eq!(mock.expect_revert(|| run(&mock)), EMPTY_REVERT);
        assert_eq!(mock.take_recorded_calls(), vec![(IMPL, calldata)]);
    }

    #[test]
    fn fallback_forwards_empty_calldata() {
        let mock = deployed_proxy(vec![]);
        mock.mock_call(IMPL, Ok(vec![]));

        run(&mock);

        assert_eq!(mock.take_recorded_calls(), vec![(IMPL, vec![])]);
        assert_eq!(mock.take_return_value(), returned(vec![]));
    }

    #[test]
    fn fallback_delegates_to_current_implementation_slot() {
        // After an upgrade rewrites the implementation slot, the fallback must
        // target the new address.
        const NEW_IMPL: [u8; 20] = [0x2D; 20];
        let mock = deployed_proxy(vec![0xAB]);
        mock.set_raw_storage(IMPLEMENTATION_SLOT.to_vec(), word_addr(NEW_IMPL).to_vec());
        mock.mock_call(NEW_IMPL, Ok(vec![0x01]));

        run(&mock);

        assert_eq!(mock.take_recorded_calls(), vec![(NEW_IMPL, vec![0xAB])]);
        assert_eq!(mock.take_return_value(), returned(vec![0x01]));
    }

    #[test]
    fn value_sent_to_the_constructor_or_a_call_reverts_empty() {
        let constructor = MockHostBuilder::new()
            .calldata([word_addr(IMPL), word_addr(ADMIN)].concat())
            .value_transferred(U256::from(1))
            .build();
        assert_eq!(
            constructor.expect_revert(|| construct(&constructor)),
            EMPTY_REVERT
        );

        let call = MockHostBuilder::new()
            .calldata(vec![1, 2, 3, 4])
            .storage(deployed_proxy(vec![]).storage_dump())
            .value_transferred(U256::from(1))
            .build();
        assert_eq!(call.expect_revert(|| run(&call)), EMPTY_REVERT);
    }
}
