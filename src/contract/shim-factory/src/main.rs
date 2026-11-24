//! Creates a PVM contract by code hash on behalf of whoever delegate-calls
//! it.
//!
//! EVM bytecode can only create EVM contracts, so the registry, which is EVM
//! bytecode, delegate-calls this to instantiate a name's shim. pallet-revive
//! attributes an instantiation made inside a delegate call to the delegating
//! contract, so the shim's address derives from the registry and not from
//! this contract, and replacing this contract moves no address.
//!
//! **Calldata** — `[32-byte salt][32-byte code hash][constructor input]`.
//!
//! **Returns** the new contract's address as one ABI word. A constructor
//! that reverts bubbles its return data as the revert; calldata shorter than
//! the two leading words, or longer than [`BUFFER_LEN`], reverts empty.
//!
//! It holds no state and checks no caller: called directly it creates a
//! contract of its own, which concerns nobody else.

#![cfg_attr(target_arch = "riscv64", no_std, no_main)]

// polkavm-linker gives a contract an 8 KiB stack unless it asks for more;
// 128 KiB is resolc's default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

use contract_host::Host;

/// `[salt][code hash]`: what every call carries before the constructor input.
const HEADER_LEN: usize = 64;
/// The longest calldata accepted. A shim's constructor input is one word.
pub const BUFFER_LEN: usize = HEADER_LEN + 1024;

/// Instantiate what the calldata describes. `buffer` is scratch space of
/// [`BUFFER_LEN`] bytes.
pub fn create<H: Host>(host: &H, buffer: &mut [u8]) {
    let len = host.call_data_size();
    if len < HEADER_LEN || len > buffer.len() {
        host.revert(&[]);
    }
    host.call_data_copy(&mut buffer[..len], 0);
    let mut salt = [0u8; 32];
    salt.copy_from_slice(&buffer[..32]);

    match host.instantiate(&buffer[32..len], Some(&salt)) {
        Some(address) => {
            let mut word = [0u8; 32];
            word[12..].copy_from_slice(&address);
            host.answer(&word);
        }
        None => {
            let size = host.return_data_size().min(buffer.len());
            host.return_data_copy(&mut buffer[..size]);
            host.revert(&buffer[..size]);
        }
    }
}

#[cfg(not(target_arch = "riscv64"))]
fn main() {}

/// The contract's entry points.
#[cfg(target_arch = "riscv64")]
mod entry {
    use super::{BUFFER_LEN, create};
    use contract_host::Chain;
    use core::ptr::addr_of_mut;

    static mut BUFFER: [u8; BUFFER_LEN] = [0; BUFFER_LEN];

    #[polkavm_derive::polkavm_export]
    extern "C" fn deploy() {}

    #[polkavm_derive::polkavm_export]
    extern "C" fn call() {
        // SAFETY: a call runs alone on a fresh instance, so nothing else
        // holds this buffer.
        create(&Chain, unsafe { &mut *addr_of_mut!(BUFFER) });
    }
}

#[cfg(test)]
mod tests {
    use super::{BUFFER_LEN, create};
    use contract_host::mock::{Instantiation, Mock, MockHostBuilder, ReturnFlags, ReturnValue};

    const SALT: [u8; 32] = [0x5A; 32];
    const CODE_HASH: [u8; 32] = [0xC0; 32];
    const CREATED: [u8; 20] = [0xDD; 20];

    fn calldata(constructor_input: &[u8]) -> Vec<u8> {
        [&SALT[..], &CODE_HASH[..], constructor_input].concat()
    }

    fn run(mock: &Mock) {
        create(mock, &mut [0u8; BUFFER_LEN]);
    }

    #[test]
    fn instantiates_the_code_hash_with_the_salt_and_returns_the_address() {
        let constructor_input = [0x11; 32];
        let mock = Mock::new(
            MockHostBuilder::new()
                .calldata(calldata(&constructor_input))
                .mock_instantiate(CREATED, vec![])
                .build(),
        );
        run(&mock);

        assert_eq!(
            mock.take_instantiations(),
            vec![Instantiation {
                input: [&CODE_HASH[..], &constructor_input[..]].concat(),
                salt: Some(SALT),
            }]
        );
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&CREATED);
        assert_eq!(
            mock.host.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: word.to_vec(),
            })
        );
    }

    #[test]
    fn a_constructor_without_input_is_instantiated_from_the_code_hash_alone() {
        let mock = Mock::new(
            MockHostBuilder::new()
                .calldata(calldata(&[]))
                .mock_instantiate(CREATED, vec![])
                .build(),
        );
        run(&mock);
        assert_eq!(mock.take_instantiations()[0].input, CODE_HASH.to_vec());
    }

    #[test]
    fn a_failed_instantiation_reverts() {
        let mock = Mock::new(MockHostBuilder::new().calldata(calldata(&[])).build());
        let reverted = mock.host.expect_revert(|| run(&mock));
        assert_eq!(reverted.flags, ReturnFlags::REVERT);
    }

    #[test]
    fn calldata_outside_the_accepted_lengths_reverts_without_instantiating() {
        for data in [vec![0u8; 63], vec![0u8; BUFFER_LEN + 1]] {
            let mock = Mock::new(
                MockHostBuilder::new()
                    .calldata(data)
                    .mock_instantiate(CREATED, vec![])
                    .build(),
            );
            mock.host.expect_revert(|| run(&mock));
            assert!(mock.take_instantiations().is_empty());
        }
    }
}
