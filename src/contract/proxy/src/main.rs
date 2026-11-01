//! Per-name CDM shim: the frozen blob behind every published contract name.
//! One instance per name owns the name's permanent address, storage, and
//! balance, and holds no policy at all: every call is answered by asking the
//! shared resolver what to do and then doing exactly that. The blob can never
//! change on-chain, so the protocol below is permanent.
//!
//! **Resolver address** — pallet immutable data, 20 bytes, written by the
//! constructor `new(address resolver)`. pallet-revive accepts
//! `set_immutable_data` only from a constructor, so no delegated code can ever
//! redirect a shim.
//!
//! **Request** — one read-only call to the resolver:
//! `resolve(address caller, uint256 value, bytes data)`, i.e. the selector
//! `0x6a418533`, the caller word, the value word, the offset word `0x60`, the
//! length word, then the shim's raw calldata zero-padded to 32 bytes
//! (`contract_registry_core::versioning::resolve::request_header`).
//!
//! **Response** — the ABI encoding of
//! `Resolution { uint8 kind, address target, uint32 strip, bytes payload }`:
//! the offset word `0x20`, the kind word, the target word, the strip word, the
//! offset word `0x80`, the length word, then the payload zero-padded.
//!
//! - kind `0` (Return): the call returns `payload`.
//! - kind `1` (Delegate): the shim delegate-calls `target` with
//!   `payload ++ data[strip..]` and bubbles the result unchanged, so every
//!   version of the name runs against this storage.
//!
//! A resolver revert bubbles byte-for-byte: the resolver's typed errors are
//! what callers see. Any other answer reverts `MalformedResolution()`, the
//! shim's only own error.
//!
//! Instantiated by the registry via CREATE2 with the resolver as the one
//! constructor argument, so a name's address is a pure function of
//! (registry, this blob, resolver address, name).

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// polkavm-linker defaults guest stacks to 8 KiB, which deep call chains
// overflow as a raw VM trap. Match resolc's production default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

// Calldata and return data are each capped at 128 KiB: the SDK dispatcher
// copies the calldata once, the request holds it again, and a bubbled revert
// payload is copied once more.
#[pvm_contract_sdk::contract(allocator = "bump", allocator_size = 524288)]
mod contract_proxy {
    use alloc::vec;
    use alloc::vec::Vec;
    use contract_registry_core::versioning::resolve;
    use pvm_contract_sdk::{Address, CallFlags, HostApi, SolError};

    /// The resolver answered with something other than a `Resolution`.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct MalformedResolution;

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub enum Error {
        MalformedResolution(MalformedResolution),
    }

    /// No fields: every storage slot belongs to the name's implementations.
    pub struct ContractProxy {}

    impl ContractProxy {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self, resolver: Address) {
            self.host().set_immutable_data(&resolver.0);
        }

        /// Every call lands here. Payable: value accrues to this address.
        #[pvm_contract_sdk::fallback]
        #[pvm_contract_sdk::payable]
        pub fn fallback(&mut self) -> Result<(), Error> {
            let host = self.host();

            let data_len = host.call_data_size() as usize;
            let data_end = resolve::REQUEST_HEADER_LEN + data_len;
            let mut request = vec![0u8; resolve::REQUEST_HEADER_LEN + data_len.div_ceil(32) * 32];
            let mut caller = [0u8; 20];
            host.caller(&mut caller);
            let mut value = [0u8; 32];
            host.value_transferred(&mut value);
            value.reverse();
            request[..resolve::REQUEST_HEADER_LEN]
                .copy_from_slice(&resolve::request_header(&caller, &value, data_len));
            host.call_data_copy(&mut request[resolve::REQUEST_HEADER_LEN..data_end], 0);

            let mut resolver = [0u8; 20];
            let mut resolver_ref: &mut [u8] = &mut resolver;
            host.get_immutable_data(&mut resolver_ref);
            let asked = host.call_evm(
                CallFlags::READ_ONLY,
                &resolver,
                u64::MAX,
                &[0u8; 32],
                &request,
                None,
            );
            let response = self.return_data();
            if asked.is_err() {
                host.revert(&response);
            }

            let resolved = resolve::decode_response(&response).ok_or(MalformedResolution)?;
            let start = resolve::REQUEST_HEADER_LEN + resolved.strip;
            if start > data_end {
                return Err(MalformedResolution.into());
            }
            match resolved.kind {
                resolve::RETURN => host.return_value(resolved.payload),
                resolve::DELEGATE => {
                    // The header and the stripped prefix are dead once the
                    // resolver has answered, so a payload that fits there is
                    // prepended in place.
                    let owned;
                    let input = if resolved.payload.len() <= start {
                        let from = start - resolved.payload.len();
                        request[from..start].copy_from_slice(resolved.payload);
                        &request[from..data_end]
                    } else {
                        owned = [resolved.payload, &request[start..data_end]].concat();
                        &owned
                    };
                    let result = host.delegate_call_evm(
                        CallFlags::TAIL_CALL,
                        &resolved.target,
                        u64::MAX,
                        input,
                        None,
                    );
                    // On-chain a successful tail call never returns here.
                    let output = self.return_data();
                    if result.is_err() {
                        host.revert(&output);
                    }
                    host.return_value(&output);
                }
                _ => return Err(MalformedResolution.into()),
            }

            #[cfg(not(target_arch = "riscv64"))]
            Ok(())
        }

        fn return_data(&self) -> Vec<u8> {
            let host = self.host();
            let mut data = vec![0u8; host.return_data_size() as usize];
            let mut data_ref: &mut [u8] = &mut data;
            host.return_data_copy(&mut data_ref, 0);
            data
        }
    }
}

/// Everything goes through `fallback()` with staged calldata and a mocked
/// resolver, so these lock the protocol bytes as well as the behavior.
#[cfg(test)]
mod tests {
    use super::contract_proxy::{ContractProxy, Error};
    use contract_registry_core::versioning::resolve;
    use pvm_contract_sdk::{
        Address, Bytes, HostApi, MockHost, MockHostBuilder, ReturnFlags, SolEncode, U256,
        types::ReturnValue,
    };

    const RESOLVER: [u8; 20] = [0x5E; 20];
    const TARGET: [u8; 20] = [0x11; 20];
    const CALLER: [u8; 20] = [0xCA; 20];
    const CALLDATA: [u8; 36] = [0x77; 36];

    /// The resolver's return type, encoded here exactly as the SDK encodes
    /// it on-chain.
    #[derive(pvm_contract_sdk::SolType)]
    struct Resolution {
        kind: u8,
        target: Address,
        strip: u32,
        payload: Bytes,
    }

    /// The resolver's answer, as `MockHost::mock_call` takes it.
    type Answer = Result<Vec<u8>, ()>;

    fn resolution(kind: u8, target: [u8; 20], strip: u32, payload: &[u8]) -> Answer {
        let value = Resolution {
            kind,
            target: Address(target),
            strip,
            payload: Bytes(payload.to_vec()),
        };
        let mut encoded = vec![0u8; value.encode_len()];
        value.encode_to(&mut encoded);
        Ok(encoded)
    }

    /// A shim pointed at `RESOLVER` with `calldata` and `value` staged, the
    /// resolver answering `response`.
    fn deployed(calldata: &[u8], value: u64, response: Answer) -> (ContractProxy, MockHost) {
        let mock = MockHostBuilder::new()
            .caller(CALLER)
            .calldata(calldata.to_vec())
            .value_transferred(U256::from(value))
            .mock_call(RESOLVER, response)
            .build();
        let mut proxy = ContractProxy::with_host(mock.clone());
        proxy.new(Address(RESOLVER));
        (proxy, mock)
    }

    /// The exact bytes the shim must send the resolver.
    fn request(calldata: &[u8], value: u64) -> Vec<u8> {
        let mut value_word = [0u8; 32];
        value_word[24..].copy_from_slice(&value.to_be_bytes());
        let mut out = resolve::request_header(&CALLER, &value_word, calldata.len()).to_vec();
        out.extend_from_slice(calldata);
        out.resize(
            resolve::REQUEST_HEADER_LEN + calldata.len().div_ceil(32) * 32,
            0,
        );
        out
    }

    #[test]
    fn constructor_pins_the_resolver_as_immutable_data() {
        let (_shim, mock) = deployed(&[], 0, Ok(vec![]));
        let mut immutable = [0u8; 32];
        let mut immutable_ref: &mut [u8] = &mut immutable;
        mock.get_immutable_data(&mut immutable_ref);
        assert_eq!(*immutable_ref, RESOLVER);
    }

    #[test]
    fn return_answers_with_the_payload_after_one_resolver_call() {
        let payload = [0xEE; 64];
        let (mut shim, mock) = deployed(
            &CALLDATA,
            7,
            resolution(resolve::RETURN, [0u8; 20], 0, &payload),
        );
        assert!(shim.fallback().is_ok());

        assert_eq!(
            mock.take_recorded_calls(),
            vec![(RESOLVER, request(&CALLDATA, 7))]
        );
        assert_eq!(
            mock.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: payload.to_vec(),
            })
        );
    }

    #[test]
    fn delegate_forwards_calldata_from_strip_and_bubbles_the_return() {
        let (mut shim, mock) =
            deployed(&CALLDATA, 0, resolution(resolve::DELEGATE, TARGET, 20, &[]));
        mock.mock_call(TARGET, Ok(vec![0x42; 32]));
        assert!(shim.fallback().is_ok());

        assert_eq!(
            mock.take_recorded_calls(),
            vec![
                (RESOLVER, request(&CALLDATA, 0)),
                (TARGET, CALLDATA[20..].to_vec()),
            ]
        );
        assert_eq!(
            mock.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: vec![0x42; 32],
            })
        );
    }

    #[test]
    fn delegate_with_strip_zero_forwards_calldata_unchanged() {
        let (mut shim, mock) =
            deployed(&CALLDATA, 0, resolution(resolve::DELEGATE, TARGET, 0, &[]));
        assert!(shim.fallback().is_ok());
        assert_eq!(mock.take_recorded_calls()[1], (TARGET, CALLDATA.to_vec()));
    }

    #[test]
    fn delegate_prepends_the_payload() {
        // Fits in the dead prefix (header + stripped bytes) ...
        let (mut shim, mock) = deployed(
            &CALLDATA,
            0,
            resolution(resolve::DELEGATE, TARGET, 4, &[0xAB; 8]),
        );
        assert!(shim.fallback().is_ok());
        assert_eq!(
            mock.take_recorded_calls()[1],
            (TARGET, [&[0xAB; 8][..], &CALLDATA[4..]].concat())
        );

        // ... and larger than it.
        let big = [0xCD; 200];
        let (mut shim, mock) =
            deployed(&CALLDATA, 0, resolution(resolve::DELEGATE, TARGET, 0, &big));
        assert!(shim.fallback().is_ok());
        assert_eq!(
            mock.take_recorded_calls()[1],
            (TARGET, [&big[..], &CALLDATA[..]].concat())
        );
    }

    #[test]
    fn empty_calldata_is_forwarded_as_an_empty_request_body() {
        let (mut shim, mock) = deployed(&[], 0, resolution(resolve::DELEGATE, TARGET, 0, &[]));
        assert!(shim.fallback().is_ok());
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(RESOLVER, request(&[], 0)), (TARGET, vec![])]
        );
    }

    #[test]
    fn resolver_revert_bubbles_and_nothing_is_delegated() {
        let (mut shim, mock) = deployed(&CALLDATA, 0, Err(()));
        let rv = mock.expect_revert(|| {
            let _ = shim.fallback();
        });
        assert_eq!(
            rv,
            ReturnValue {
                flags: ReturnFlags::REVERT,
                data: vec![],
            }
        );
        assert_eq!(mock.take_recorded_calls().len(), 1);
    }

    #[test]
    fn implementation_revert_bubbles() {
        let (mut shim, mock) =
            deployed(&CALLDATA, 0, resolution(resolve::DELEGATE, TARGET, 0, &[]));
        mock.mock_call(TARGET, Err(()));
        let rv = mock.expect_revert(|| {
            let _ = shim.fallback();
        });
        assert_eq!(rv.flags, ReturnFlags::REVERT);
    }

    #[test]
    fn malformed_answers_revert_malformed_resolution() {
        let short = Ok(vec![0u8; resolve::RESPONSE_HEAD_LEN - 1]);
        let unknown_kind = resolution(2, TARGET, 0, &[]);
        let strip_past_end = resolution(resolve::DELEGATE, TARGET, CALLDATA.len() as u32 + 1, &[]);
        for answer in [short, unknown_kind, strip_past_end] {
            let (mut shim, mock) = deployed(&CALLDATA, 0, answer);
            assert!(matches!(
                shim.fallback(),
                Err(Error::MalformedResolution(_))
            ));
            assert_eq!(mock.take_recorded_calls().len(), 1);
        }
    }
}
