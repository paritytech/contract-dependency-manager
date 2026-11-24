//! [`Host`] over the pvm-contract-sdk mock host, for unit tests.

extern crate std;

use crate::Host;
use pvm_contract_sdk::{CallFlags, HostApi, StorageFlags};

pub use pvm_contract_sdk::{MockHost, MockHostBuilder, ReturnFlags, U256, types::ReturnValue};

impl Host for MockHost {
    fn call_data_size(&self) -> usize {
        HostApi::call_data_size(self) as usize
    }

    fn call_data_copy(&self, output: &mut [u8], offset: usize) {
        HostApi::call_data_copy(self, output, offset as u32);
    }

    fn load(&self, key: &[u8; 32]) -> [u8; 32] {
        let mut word = [0u8; 32];
        self.get_storage_or_zero(StorageFlags::empty(), key, &mut word);
        word
    }

    fn store(&self, key: &[u8; 32], value: &[u8; 32]) {
        self.set_storage_or_clear(StorageFlags::empty(), key, value);
    }

    fn address(&self) -> [u8; 20] {
        let mut address = [0u8; 20];
        HostApi::address(self, &mut address);
        address
    }

    fn caller(&self) -> [u8; 20] {
        let mut caller = [0u8; 20];
        HostApi::caller(self, &mut caller);
        caller
    }

    fn value(&self) -> [u8; 32] {
        let mut value = [0u8; 32];
        self.value_transferred(&mut value);
        value.reverse();
        value
    }

    fn immutable_data(&self, output: &mut [u8]) {
        self.get_immutable_data(&mut &mut output[..]);
    }

    fn set_immutable_data(&self, data: &[u8]) {
        HostApi::set_immutable_data(self, data);
    }

    fn call(&self, callee: &[u8; 20], input: &[u8]) -> bool {
        self.call_evm(
            CallFlags::empty(),
            callee,
            u64::MAX,
            &[0u8; 32],
            input,
            None,
        )
        .is_ok()
    }

    fn static_call(&self, callee: &[u8; 20], input: &[u8]) -> bool {
        self.call_evm(
            CallFlags::READ_ONLY,
            callee,
            u64::MAX,
            &[0u8; 32],
            input,
            None,
        )
        .is_ok()
    }

    fn delegate_call(&self, target: &[u8; 20], input: &[u8]) -> bool {
        self.delegate_call_evm(CallFlags::TAIL_CALL, target, u64::MAX, input, None)
            .is_ok()
    }

    fn instantiate(&self, input: &[u8], salt: Option<&[u8; 32]>) -> Option<[u8; 20]> {
        let mut address = [0u8; 20];
        HostApi::instantiate(
            self,
            u64::MAX,
            u64::MAX,
            &[0xff; 32],
            &[0u8; 32],
            input,
            Some(&mut address),
            None,
            salt,
        )
        .is_ok()
        .then_some(address)
    }

    fn return_data_size(&self) -> usize {
        HostApi::return_data_size(self) as usize
    }

    fn return_data_copy(&self, output: &mut [u8]) {
        HostApi::return_data_copy(self, &mut &mut output[..], 0);
    }

    fn keccak256(&self, input: &[u8]) -> [u8; 32] {
        let mut hash = [0u8; 32];
        self.hash_keccak_256(input, &mut hash);
        hash
    }

    fn emit(&self, topics: &[[u8; 32]], data: &[u8]) {
        self.deposit_event(topics, data);
    }

    fn answer(&self, data: &[u8]) {
        self.return_value(data);
    }

    fn revert(&self, data: &[u8]) -> ! {
        HostApi::revert(self, data)
    }
}

/// What one [`Host::instantiate`] call was given.
#[derive(Debug, PartialEq, Eq)]
pub struct Instantiation {
    pub input: std::vec::Vec<u8>,
    pub salt: Option<[u8; 32]>,
}

/// The mock host, also keeping what each instantiation was given, which
/// `MockHost` itself does not record.
pub struct Mock {
    pub host: MockHost,
    instantiations: core::cell::RefCell<std::vec::Vec<Instantiation>>,
}

impl Mock {
    pub fn new(host: MockHost) -> Self {
        Self {
            host,
            instantiations: Default::default(),
        }
    }

    /// The instantiations so far, in order; clears the log.
    pub fn take_instantiations(&self) -> std::vec::Vec<Instantiation> {
        self.instantiations.take()
    }
}

impl Host for Mock {
    fn call_data_size(&self) -> usize {
        Host::call_data_size(&self.host)
    }

    fn call_data_copy(&self, output: &mut [u8], offset: usize) {
        Host::call_data_copy(&self.host, output, offset);
    }

    fn load(&self, key: &[u8; 32]) -> [u8; 32] {
        self.host.load(key)
    }

    fn store(&self, key: &[u8; 32], value: &[u8; 32]) {
        self.host.store(key, value);
    }

    fn address(&self) -> [u8; 20] {
        Host::address(&self.host)
    }

    fn caller(&self) -> [u8; 20] {
        Host::caller(&self.host)
    }

    fn value(&self) -> [u8; 32] {
        self.host.value()
    }

    fn immutable_data(&self, output: &mut [u8]) {
        self.host.immutable_data(output);
    }

    fn set_immutable_data(&self, data: &[u8]) {
        Host::set_immutable_data(&self.host, data);
    }

    fn call(&self, callee: &[u8; 20], input: &[u8]) -> bool {
        Host::call(&self.host, callee, input)
    }

    fn static_call(&self, callee: &[u8; 20], input: &[u8]) -> bool {
        self.host.static_call(callee, input)
    }

    fn delegate_call(&self, target: &[u8; 20], input: &[u8]) -> bool {
        Host::delegate_call(&self.host, target, input)
    }

    fn instantiate(&self, input: &[u8], salt: Option<&[u8; 32]>) -> Option<[u8; 20]> {
        self.instantiations.borrow_mut().push(Instantiation {
            input: input.to_vec(),
            salt: salt.copied(),
        });
        Host::instantiate(&self.host, input, salt)
    }

    fn return_data_size(&self) -> usize {
        Host::return_data_size(&self.host)
    }

    fn return_data_copy(&self, output: &mut [u8]) {
        Host::return_data_copy(&self.host, output);
    }

    fn keccak256(&self, input: &[u8]) -> [u8; 32] {
        self.host.keccak256(input)
    }

    fn emit(&self, topics: &[[u8; 32]], data: &[u8]) {
        self.host.emit(topics, data);
    }

    fn answer(&self, data: &[u8]) {
        self.host.answer(data);
    }

    fn revert(&self, data: &[u8]) -> ! {
        Host::revert(&self.host, data)
    }
}
