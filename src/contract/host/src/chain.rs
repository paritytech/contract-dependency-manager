//! [`Host`] on chain, plus the panic handler every contract blob needs.

use crate::Host;
use pallet_revive_uapi::{CallFlags, HostFn, HostFnImpl as api, ReturnFlags, StorageFlags};

/// No limit of its own: bounded by the caller's frame.
const DEPOSIT_LIMIT: [u8; 32] = [0xff; 32];
const NO_VALUE: [u8; 32] = [0u8; 32];

pub struct Chain;

impl Host for Chain {
    fn call_data_size(&self) -> usize {
        api::call_data_size() as usize
    }

    fn call_data_copy(&self, output: &mut [u8], offset: usize) {
        api::call_data_copy(output, offset as u32);
    }

    fn load(&self, key: &[u8; 32]) -> [u8; 32] {
        let mut word = [0u8; 32];
        api::get_storage_or_zero(StorageFlags::empty(), key, &mut word);
        word
    }

    fn store(&self, key: &[u8; 32], value: &[u8; 32]) {
        api::set_storage_or_clear(StorageFlags::empty(), key, value);
    }

    fn address(&self) -> [u8; 20] {
        let mut address = [0u8; 20];
        api::address(&mut address);
        address
    }

    fn caller(&self) -> [u8; 20] {
        let mut caller = [0u8; 20];
        api::caller(&mut caller);
        caller
    }

    fn value(&self) -> [u8; 32] {
        let mut value = [0u8; 32];
        api::value_transferred(&mut value);
        value.reverse();
        value
    }

    fn immutable_data(&self, output: &mut [u8]) {
        api::get_immutable_data(&mut &mut output[..]);
    }

    fn set_immutable_data(&self, data: &[u8]) {
        api::set_immutable_data(data);
    }

    fn call(&self, callee: &[u8; 20], input: &[u8]) -> bool {
        api::call_evm(CallFlags::empty(), callee, u64::MAX, &NO_VALUE, input, None).is_ok()
    }

    fn static_call(&self, callee: &[u8; 20], input: &[u8]) -> bool {
        api::call_evm(
            CallFlags::READ_ONLY,
            callee,
            u64::MAX,
            &NO_VALUE,
            input,
            None,
        )
        .is_ok()
    }

    fn delegate_call(&self, target: &[u8; 20], input: &[u8]) -> bool {
        api::delegate_call_evm(CallFlags::TAIL_CALL, target, u64::MAX, input, None).is_ok()
    }

    fn instantiate(&self, input: &[u8], salt: Option<&[u8; 32]>) -> Option<[u8; 20]> {
        let mut address = [0u8; 20];
        api::instantiate(
            u64::MAX,
            u64::MAX,
            &DEPOSIT_LIMIT,
            &NO_VALUE,
            input,
            Some(&mut address),
            None,
            salt,
        )
        .is_ok()
        .then_some(address)
    }

    fn return_data_size(&self) -> usize {
        api::return_data_size() as usize
    }

    fn return_data_copy(&self, output: &mut [u8]) {
        api::return_data_copy(&mut &mut output[..], 0);
    }

    fn keccak256(&self, input: &[u8]) -> [u8; 32] {
        let mut hash = [0u8; 32];
        api::hash_keccak_256(input, &mut hash);
        hash
    }

    fn emit(&self, topics: &[[u8; 32]], data: &[u8]) {
        api::deposit_event(topics, data);
    }

    fn answer(&self, data: &[u8]) {
        api::return_value(ReturnFlags::empty(), data)
    }

    fn revert(&self, data: &[u8]) -> ! {
        api::return_value(ReturnFlags::REVERT, data)
    }
}

#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! {
    // SAFETY: an invalid instruction traps the contract, which is what a
    // panic must do.
    unsafe {
        core::arch::asm!("unimp", options(noreturn));
    }
}
