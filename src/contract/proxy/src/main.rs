//! EIP-1967 proxy for the CDM ContractRegistry.
//!
//! This contract owns the registry's stable on-chain address. It holds no
//! logic of its own: every call is forwarded via `delegate_call` to the
//! implementation address stored at the EIP-1967 implementation slot, so the
//! implementation's methods run against this proxy's storage. Upgrades go
//! through the implementation's `setCode`, which rewrites that slot — the
//! proxy itself never needs to change.

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// polkavm-linker defaults guest stacks to 8 KiB, which deep call chains
// overflow as a raw VM trap. Match resolc's production default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 262144)]
mod registry_proxy {
    use alloc::vec;
    use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT};
    use pvm_contract_sdk::{Address, CallFlags, EmptyError, HostApi, Lazy};

    pub struct RegistryProxy {
        /// No ordinary fields: slots 0.. belong to the implementation's
        /// storage, reached through `delegate_call`.
        #[slot(raw = IMPLEMENTATION_SLOT)]
        implementation: Lazy<Address>,
        #[slot(raw = ADMIN_SLOT)]
        admin: Lazy<Address>,
    }

    impl RegistryProxy {
        /// `admin` is an explicit argument, NOT `caller()`: deployed through
        /// the CREATE3 factory, this constructor's caller is the single-use
        /// child deployer — pinning admin to it would lock the registry's
        /// admin surface to a dead contract forever. CREATE3 addresses don't
        /// commit to constructor input, so passing the admin is free.
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self, implementation: Address, admin: Address) {
            self.implementation.set(&implementation);
            self.admin.set(&admin);
        }

        /// Forward any call — the proxy declares no methods, so every
        /// selector lands here — and bubble the implementation's return or
        /// revert data unchanged.
        #[pvm_contract_sdk::fallback]
        pub fn fallback(&mut self) -> Result<(), EmptyError> {
            let host = self.host();

            let input_len = host.call_data_size() as usize;
            let mut input = vec![0u8; input_len];
            host.call_data_copy(&mut input, 0);

            let target = self.implementation.get();
            let result =
                host.delegate_call_evm(CallFlags::empty(), &target.0, u64::MAX, &input, None);

            let output_len = host.return_data_size() as usize;
            let mut output = vec![0u8; output_len];
            let mut output_ref: &mut [u8] = &mut output;
            host.return_data_copy(&mut output_ref, 0);

            if result.is_err() {
                host.revert(&output);
            }
            host.return_value(&output);

            // `return_value` diverges on-chain; on host targets (unit tests)
            // it records the payload and control returns here.
            #[cfg(not(target_arch = "riscv64"))]
            Ok(())
        }
    }
}

/// Host-side unit tests for the EIP-1967 registry proxy.
///
/// The proxy has exactly two behaviors: the constructor pins the
/// implementation and admin into their EIP-1967 slots, and the fallback
/// forwards any calldata to the implementation via delegate-call, bubbling
/// the return or revert data unchanged.
#[cfg(test)]
mod tests {
    use super::registry_proxy::RegistryProxy;
    use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT};
    use pvm_contract_sdk::{Address, MockHost, MockHostBuilder, ReturnFlags, types::ReturnValue};

    const DEPLOYER: [u8; 20] = [0xAA; 20];
    const IMPL: [u8; 20] = [0x1C; 20];

    /// A 20-byte address right-aligned in a 32-byte storage word, the layout
    /// `Lazy<Address>` uses for raw slots (and solc uses for EIP-1967 slots).
    fn word_addr(address: [u8; 20]) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    /// Deploy the proxy pointing at `IMPL`, with `calldata` staged for the
    /// fallback to forward.
    fn deployed_proxy(calldata: Vec<u8>) -> (RegistryProxy, MockHost) {
        let mock = MockHostBuilder::new()
            .caller(DEPLOYER)
            .calldata(calldata)
            .build();
        let mut proxy = RegistryProxy::with_host(mock.clone());
        proxy.new(Address(IMPL), Address(DEPLOYER));
        (proxy, mock)
    }

    #[test]
    fn constructor_pins_implementation_and_admin_slots() {
        let (_proxy, mock) = deployed_proxy(vec![]);

        assert_eq!(
            mock.get_raw_storage(&IMPLEMENTATION_SLOT),
            Some(word_addr(IMPL).to_vec())
        );
        assert_eq!(
            mock.get_raw_storage(&ADMIN_SLOT),
            Some(word_addr(DEPLOYER).to_vec())
        );
    }

    #[test]
    fn fallback_forwards_calldata_and_returns_success_payload() {
        // Arbitrary selector-shaped calldata; the proxy must not interpret it.
        let calldata: Vec<u8> = [0xbf, 0x40, 0xfa, 0xc1]
            .into_iter()
            .chain([0x11; 64])
            .collect();
        let (mut proxy, mock) = deployed_proxy(calldata.clone());
        let payload = vec![0xEE; 96];
        mock.mock_call(IMPL, Ok(payload.clone()));

        assert!(proxy.fallback().is_ok());

        // Exactly one delegate-call, to the implementation, with the calldata
        // byte-for-byte.
        assert_eq!(mock.take_recorded_calls(), vec![(IMPL, calldata)]);
        // The callee's success payload is returned unchanged.
        assert_eq!(
            mock.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: payload,
            })
        );
    }

    #[test]
    fn fallback_bubbles_callee_revert() {
        let calldata = vec![1, 2, 3, 4];
        let (mut proxy, mock) = deployed_proxy(calldata.clone());
        // MockHost's `Err(())` models a revert with no payload, so the bubbled
        // revert data must be empty.
        mock.mock_call(IMPL, Err(()));

        let rv = mock.expect_revert(|| {
            let _ = proxy.fallback();
        });

        assert_eq!(
            rv,
            ReturnValue {
                flags: ReturnFlags::REVERT,
                data: vec![],
            }
        );
        assert_eq!(mock.take_recorded_calls(), vec![(IMPL, calldata)]);
    }

    #[test]
    fn fallback_forwards_empty_calldata() {
        let (mut proxy, mock) = deployed_proxy(vec![]);
        mock.mock_call(IMPL, Ok(vec![]));

        assert!(proxy.fallback().is_ok());

        assert_eq!(mock.take_recorded_calls(), vec![(IMPL, vec![])]);
        assert_eq!(
            mock.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: vec![],
            })
        );
    }

    #[test]
    fn fallback_delegates_to_current_implementation_slot() {
        // After an upgrade rewrites the implementation slot, the fallback must
        // target the new address.
        const NEW_IMPL: [u8; 20] = [0x2D; 20];
        let (mut proxy, mock) = deployed_proxy(vec![0xAB]);
        mock.set_raw_storage(IMPLEMENTATION_SLOT.to_vec(), word_addr(NEW_IMPL).to_vec());
        mock.mock_call(NEW_IMPL, Ok(vec![0x01]));

        assert!(proxy.fallback().is_ok());

        assert_eq!(mock.take_recorded_calls(), vec![(NEW_IMPL, vec![0xAB])]);
        assert_eq!(
            mock.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: vec![0x01],
            })
        );
    }
}
