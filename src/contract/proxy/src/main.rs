//! Per-name CDM shim: the frozen blob behind every published contract name.
//! One instance per name owns the name's permanent address, storage, and
//! balance. It keeps a copy of the name's latest version and serves it
//! directly; for anything else it asks the shared resolver what to do and
//! does exactly that — until it is sealed, after which it serves that one
//! version forever. The blob can never change on-chain, so the protocol
//! below is permanent.
//!
//! **Resolver address** — pallet immutable data, 20 bytes, written by the
//! constructor `new(address resolver)`. pallet-revive accepts
//! `set_immutable_data` only from a constructor, so no delegated code can ever
//! redirect a shim.
//!
//! **Own storage** — one slot at `keccak256(label) - 1`
//! (`contract_registry_core::versioning::shim`); every other slot belongs to
//! the name's implementations.
//!
//! `FAST_SLOT` (`cdm.shim.fast`) holds the word `[sealed: 1 bit][version
//! key: 95 bits big-endian][implementation: 20 bytes]`. A publishable key
//! has its top 33 bits clear, so 95 bits hold all of it. A zero
//! implementation means no shortcut. The sealed bit is set by `seal` and
//! nothing clears it; every decision below reads this one word, so a set
//! bit always means sealed.
//!
//! **Calldata** is classified by `versioning::route_calldata`: *plain* (no
//! `MAGIC` prefix), *versioned* (`[MAGIC][16-byte key != 0][inner calldata]`),
//! *meta* (`[MAGIC][key = 0][4-byte selector][ABI args]`), or *malformed* (the
//! `MAGIC` prefix on calldata too short for either form).
//!
//! **Call handling**, in this order:
//!
//! 1. *Shortcut.* When `FAST_SLOT` holds a non-zero implementation:
//!    - a plain call tail-delegate-calls it with the calldata unchanged;
//!    - a versioned call whose 16-byte key equals the stored key
//!      tail-delegate-calls it with the calldata past the 20-byte
//!      `[MAGIC][key]` header;
//!    - the meta call `latest()` `0x52bfe789` returns `(uint128 key, address
//!      implementation)`: the two fields of `FAST_SLOT` as ABI words, which
//!      is the resolver's answer for the same version.
//!
//!    Reading `FAST_SLOT` is the only storage access on this path, and the
//!    resolver is not called.
//! 2. *Own meta calls.* A meta call with one of these selectors is handled
//!    here, sealed or not, and never reaches the resolver:
//!    - `sealed()` `0xe4b203ef` returns `bool`.
//!    - `resolver()` `0x04f3bcec` returns `address`: the immutable resolver.
//!    - `setFastPath(uint128 key, address implementation)` `0x8682471f`
//!      reverts `NotResolver()` unless the caller is the resolver, then
//!      `Sealed()` if the shim is sealed. A zero `implementation` clears
//!      `FAST_SLOT`; a non-zero one is stored with `key`, which must be
//!      publishable (non-zero, top 33 bits clear), else `MalformedCall()`.
//!    - `seal(uint128 key, address implementation)` `0xe2e33028` reverts
//!      `NotResolver()` unless the caller is the resolver, then `Sealed()` if
//!      the shim is already sealed. `implementation` must be non-zero and
//!      `key` publishable, else `MalformedCall()`. It stores them in
//!      `FAST_SLOT` with the sealed bit set.
//!
//!    The two writes check the caller, then the seal, then their arguments,
//!    which they read as two ABI words after the 24-byte meta header: a
//!    missing word, or non-zero padding in either, is `MalformedCall()`. They
//!    return nothing. Bytes past a selector's arguments are ignored.
//! 3. *Everything else* — a plain call or `latest()` without a shortcut, a
//!    versioned call for another key, any other meta selector, malformed
//!    calldata — reverts `Sealed()` when the sealed bit is set, and otherwise
//!    goes to the resolver.
//!
//! `seal` stores an implementation with the sealed bit, so step 1 keeps
//! serving plain calls, calls pinned to the sealed key and `latest()`, and no
//! other version is ever served again. A shim whose sealed bit is set never
//! calls the resolver, whatever the rest of the word holds. An unsealed shim
//! with a zero `FAST_SLOT` sends every call but its own meta calls to the
//! resolver.
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
//! - kind `1` (Delegate): the shim tail-delegate-calls `target` with
//!   `payload ++ data[strip..]`.
//!
//! A resolver revert bubbles byte-for-byte: the resolver's typed errors are
//! what callers see. Any other answer reverts `MalformedResolution()`.
//!
//! Every delegate call, from the shortcut or from a `Resolution`, runs the
//! implementation against this storage and bubbles its return data or revert
//! unchanged. The shim is payable on every path: value sent with a call
//! stays at this address.
//!
//! **Errors** raised by the shim itself: `MalformedResolution()`,
//! `NotResolver()`, `Sealed()`, `MalformedCall()`.
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
    use contract_registry_core::versioning::{
        CallRoute, META_HEADER_LEN, VERSIONED_HEADER_LEN, is_publishable_key, meta, resolve,
        route_calldata, shim,
    };
    use pvm_contract_sdk::{Address, CallFlags, HostApi, SolError, StorageFlags};

    /// The resolver answered with something other than a `Resolution`.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct MalformedResolution;

    /// `setFastPath` or `seal` from anyone but the resolver.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct NotResolver;

    /// The shim is sealed: it serves its sealed version and nothing else.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct Sealed;

    /// `setFastPath` or `seal` with undecodable or invalid arguments.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct MalformedCall;

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub enum Error {
        MalformedResolution(MalformedResolution),
        NotResolver(NotResolver),
        Sealed(Sealed),
        MalformedCall(MalformedCall),
    }

    /// No fields: the shim's own state sits at the one fixed slot in
    /// `versioning::shim`, and every other slot belongs to the name's
    /// implementations.
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
            let mut head = [0u8; META_HEADER_LEN];
            let head_len = data_len.min(META_HEADER_LEN);
            host.call_data_copy(&mut head[..head_len], 0);
            let route = route_calldata(&head[..head_len]);

            let mut fast = [0u8; 32];
            host.get_storage_or_zero(StorageFlags::empty(), &shim::FAST_SLOT, &mut fast);
            let (sealed, fast_key, implementation) = shim::unpack_fast_path(&fast);
            if implementation != [0u8; 20] {
                let strip = match route {
                    CallRoute::Plain => Some(0),
                    CallRoute::Versioned(key) if key == fast_key => Some(VERSIONED_HEADER_LEN),
                    _ => None,
                };
                if let Some(strip) = strip {
                    let mut input = vec![0u8; data_len - strip];
                    host.call_data_copy(&mut input, strip as u32);
                    return self.delegate(&implementation, &input);
                }
            }

            // Selectors are compared whole: an array `match` would test them
            // byte by byte, and every byte of this blob is proof size.
            if let CallRoute::Meta(selector) = route {
                // The shim's copy is the pair the resolver would answer with.
                if selector == meta::LATEST && implementation != [0u8; 20] {
                    let mut words = [0u8; 64];
                    words[16..32].copy_from_slice(&fast_key.to_be_bytes());
                    words[44..].copy_from_slice(&implementation);
                    return self.answer(&words);
                }
                if selector == shim::SEALED {
                    let mut word = [0u8; 32];
                    word[31] = sealed as u8;
                    return self.answer(&word);
                }
                if selector == shim::RESOLVER {
                    let mut word = [0u8; 32];
                    word[12..].copy_from_slice(&self.resolver());
                    return self.answer(&word);
                }
                if selector == shim::SET_FAST_PATH {
                    return self.store_fast_path(data_len, sealed, false);
                }
                if selector == shim::SEAL {
                    return self.store_fast_path(data_len, sealed, true);
                }
            }

            if sealed {
                return Err(Sealed.into());
            }

            // Nothing above allocates for the resolver: the request is built
            // only once the call is known to need it.
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

            let asked = host.call_evm(
                CallFlags::READ_ONLY,
                &self.resolver(),
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
                resolve::RETURN => self.answer(resolved.payload),
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
                    self.delegate(&resolved.target, input)
                }
                _ => Err(MalformedResolution.into()),
            }
        }

        /// `setFastPath`, or `seal` when `seal` is set: resolver-only, never
        /// on a shim that is already `sealed`, with `(uint128 key, address
        /// implementation)` after the meta header.
        fn store_fast_path(&self, data_len: usize, sealed: bool, seal: bool) -> Result<(), Error> {
            let host = self.host();
            let mut caller = [0u8; 20];
            host.caller(&mut caller);
            if caller != self.resolver() {
                return Err(NotResolver.into());
            }
            if sealed {
                return Err(Sealed.into());
            }

            let mut args = [0u8; 64];
            if data_len < META_HEADER_LEN + args.len() {
                return Err(MalformedCall.into());
            }
            host.call_data_copy(&mut args, META_HEADER_LEN as u32);
            if args[..16] != [0u8; 16] || args[32..44] != [0u8; 12] {
                return Err(MalformedCall.into());
            }
            let mut key = [0u8; 16];
            key.copy_from_slice(&args[16..32]);
            let key = u128::from_be_bytes(key);
            let mut implementation = [0u8; 20];
            implementation.copy_from_slice(&args[44..]);

            let word = if implementation != [0u8; 20] {
                if !is_publishable_key(key) {
                    return Err(MalformedCall.into());
                }
                shim::pack_fast_path(key, &implementation, seal)
            } else if seal {
                return Err(MalformedCall.into());
            } else {
                [0u8; 32]
            };
            host.set_storage_or_clear(StorageFlags::empty(), &shim::FAST_SLOT, &word);
            self.answer(&[])
        }

        /// Tail delegate-call `target` with `input` and bubble its result
        /// unchanged.
        fn delegate(&self, target: &[u8; 20], input: &[u8]) -> Result<(), Error> {
            let host = self.host();
            let result =
                host.delegate_call_evm(CallFlags::TAIL_CALL, target, u64::MAX, input, None);
            // On-chain a successful tail call never returns here.
            let output = self.return_data();
            if result.is_err() {
                host.revert(&output);
            }
            self.answer(&output)
        }

        // The helpers below stay out of line so the blob carries one copy of
        // each instead of one per call site.

        /// End the call returning `data`. On-chain this never returns.
        #[inline(never)]
        fn answer(&self, data: &[u8]) -> Result<(), Error> {
            self.host().return_value(data);

            #[cfg(not(target_arch = "riscv64"))]
            Ok(())
        }

        #[inline(never)]
        fn resolver(&self) -> [u8; 20] {
            let mut resolver = [0u8; 20];
            let mut resolver_ref: &mut [u8] = &mut resolver;
            self.host().get_immutable_data(&mut resolver_ref);
            resolver
        }

        #[inline(never)]
        fn return_data(&self) -> Vec<u8> {
            let host = self.host();
            let mut data = vec![0u8; host.return_data_size() as usize];
            let mut data_ref: &mut [u8] = &mut data;
            host.return_data_copy(&mut data_ref, 0);
            data
        }
    }
}

/// Everything goes through `fallback()` with staged calldata, seeded storage,
/// and a mocked resolver, so these lock the protocol bytes as well as the
/// behavior.
#[cfg(test)]
mod tests {
    use super::contract_proxy::{ContractProxy, Error};
    use contract_registry_core::versioning::shim::{
        FAST_SLOT, SEAL, SEALED, SEALED_FLAG, SET_FAST_PATH, pack_fast_path,
    };
    use contract_registry_core::versioning::{self, MAGIC, META_KEY, meta, pack_version, resolve};
    use pvm_contract_sdk::{
        Address, Bytes, HostApi, MockHost, MockHostBuilder, ReturnFlags, SolEncode, U256,
        types::ReturnValue,
    };

    const RESOLVER: [u8; 20] = [0x5E; 20];
    const TARGET: [u8; 20] = [0x11; 20];
    const OTHER_TARGET: [u8; 20] = [0x22; 20];
    const CALLER: [u8; 20] = [0xCA; 20];
    const CALLDATA: [u8; 36] = [0x77; 36];
    /// The calldata a versioned call carries after its header.
    const INNER: [u8; 36] = [0x33; 36];

    const V1_2_3: u128 = pack_version(1, 2, 3);
    const V2_0_0: u128 = pack_version(2, 0, 0);

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
        deployed_as(CALLER, calldata, value, response)
    }

    /// `deployed`, with `caller` making the call.
    fn deployed_as(
        caller: [u8; 20],
        calldata: &[u8],
        value: u64,
        response: Answer,
    ) -> (ContractProxy, MockHost) {
        let mock = MockHostBuilder::new()
            .caller(caller)
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

    /// Put `(key, implementation)` in the shim's fast-path slot.
    fn store_fast_path(mock: &MockHost, key: u128, implementation: [u8; 20]) {
        mock.set_raw_storage(
            FAST_SLOT.to_vec(),
            pack_fast_path(key, &implementation, false).to_vec(),
        );
    }

    /// Seal the shim on `(key, implementation)`.
    fn store_sealed(mock: &MockHost, key: u128, implementation: [u8; 20]) {
        mock.set_raw_storage(
            FAST_SLOT.to_vec(),
            pack_fast_path(key, &implementation, true).to_vec(),
        );
    }

    fn versioned(key: u128, inner: &[u8]) -> Vec<u8> {
        [&MAGIC[..], &key.to_be_bytes(), inner].concat()
    }

    fn meta_call(selector: [u8; 4], args: &[u8]) -> Vec<u8> {
        [&MAGIC[..], &META_KEY.to_be_bytes(), &selector, args].concat()
    }

    fn word_u128(value: u128) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[16..].copy_from_slice(&value.to_be_bytes());
        word
    }

    fn word_addr(address: [u8; 20]) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    /// `(uint128 key, address implementation)` as `setFastPath` and `seal`
    /// take them.
    fn fast_path_args(key: u128, implementation: [u8; 20]) -> Vec<u8> {
        [word_u128(key), word_addr(implementation)].concat()
    }

    /// A successful return of `data`.
    fn returns(data: &[u8]) -> Option<ReturnValue> {
        Some(ReturnValue {
            flags: ReturnFlags::empty(),
            data: data.to_vec(),
        })
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

    // ─── Shortcut ────────────────────────────────────────────────────────

    #[test]
    fn plain_call_with_a_shortcut_delegates_without_asking_the_resolver() {
        for calldata in [&CALLDATA[..], &[]] {
            let (mut shim, mock) = deployed(calldata, 0, Err(()));
            store_fast_path(&mock, V1_2_3, TARGET);
            mock.mock_call(TARGET, Ok(vec![0x42; 32]));
            assert!(shim.fallback().is_ok());

            assert_eq!(
                mock.take_recorded_calls(),
                vec![(TARGET, calldata.to_vec())]
            );
            assert_eq!(mock.take_return_value(), returns(&[0x42; 32]));
        }
    }

    #[test]
    fn call_pinned_to_the_stored_key_delegates_past_the_header() {
        for inner in [&INNER[..], &[]] {
            let (mut shim, mock) = deployed(&versioned(V1_2_3, inner), 0, Err(()));
            store_fast_path(&mock, V1_2_3, TARGET);
            assert!(shim.fallback().is_ok());
            assert_eq!(mock.take_recorded_calls(), vec![(TARGET, inner.to_vec())]);
        }
    }

    #[test]
    fn call_pinned_to_another_key_asks_the_resolver() {
        // A different version, and keys equal to the stored one except in
        // bits the word does not hold.
        for key in [V2_0_0, V1_2_3 | 1 << 96, V1_2_3 | 1 << 95] {
            let calldata = versioned(key, &INNER);
            let (mut shim, mock) = deployed(
                &calldata,
                0,
                resolution(resolve::DELEGATE, OTHER_TARGET, 20, &[]),
            );
            store_fast_path(&mock, V1_2_3, TARGET);
            assert!(shim.fallback().is_ok());
            assert_eq!(
                mock.take_recorded_calls(),
                vec![
                    (RESOLVER, request(&calldata, 0)),
                    (OTHER_TARGET, INNER.to_vec()),
                ]
            );
        }
    }

    #[test]
    fn versioned_call_without_a_shortcut_asks_the_resolver() {
        let calldata = versioned(V1_2_3, &INNER);
        let (mut shim, mock) =
            deployed(&calldata, 0, resolution(resolve::DELEGATE, TARGET, 20, &[]));
        assert!(shim.fallback().is_ok());
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(RESOLVER, request(&calldata, 0)), (TARGET, INNER.to_vec())]
        );
    }

    #[test]
    fn latest_with_a_shortcut_answers_the_stored_pair() {
        let set = |mock: &MockHost| store_fast_path(mock, V1_2_3, TARGET);
        assert_eq!(
            query(meta::LATEST, &[], set),
            returns(&[word_u128(V1_2_3), word_addr(TARGET)].concat())
        );
    }

    #[test]
    fn latest_without_a_shortcut_asks_the_resolver() {
        let calldata = meta_call(meta::LATEST, &[]);
        let (mut shim, mock) = deployed(
            &calldata,
            0,
            resolution(resolve::RETURN, [0u8; 20], 0, &[0xEE; 64]),
        );
        assert!(shim.fallback().is_ok());
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(RESOLVER, request(&calldata, 0))]
        );
        assert_eq!(mock.take_return_value(), returns(&[0xEE; 64]));
    }

    #[test]
    fn other_meta_and_malformed_calls_ask_the_resolver_despite_a_shortcut() {
        let truncated_selector = [&MAGIC[..], &[0u8; 18]].concat();
        for calldata in [
            meta_call(meta::FROZEN, &[]),
            MAGIC.to_vec(),
            truncated_selector,
        ] {
            let (mut shim, mock) = deployed(
                &calldata,
                0,
                resolution(resolve::RETURN, [0u8; 20], 0, &[0xEE; 32]),
            );
            store_fast_path(&mock, V1_2_3, TARGET);
            assert!(shim.fallback().is_ok());
            assert_eq!(
                mock.take_recorded_calls(),
                vec![(RESOLVER, request(&calldata, 0))]
            );
        }
    }

    #[test]
    fn shortcut_call_with_value_keeps_it_at_the_shim() {
        let (mut shim, mock) = deployed(&CALLDATA, 7, Err(()));
        store_fast_path(&mock, V1_2_3, TARGET);
        assert!(shim.fallback().is_ok());

        // The implementation is delegate-called, which carries no value: it
        // runs with the 7 as its own call value and nothing is sent on.
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(TARGET, CALLDATA.to_vec())]
        );
        assert!(mock.recorded_call_values().is_empty());
    }

    // ─── Getters ─────────────────────────────────────────────────────────

    /// What the shim answers to `[MAGIC][0][selector][args]` after `seed`
    /// has prepared its storage, without calling anyone.
    fn query(selector: [u8; 4], args: &[u8], seed: impl Fn(&MockHost)) -> Option<ReturnValue> {
        let (mut shim, mock) = deployed(&meta_call(selector, args), 0, Err(()));
        seed(&mock);
        assert!(shim.fallback().is_ok());
        assert!(mock.take_recorded_calls().is_empty());
        mock.take_return_value()
    }

    #[test]
    fn getters_answer_with_abi_words() {
        let unset = |_: &MockHost| {};
        let set = |mock: &MockHost| store_fast_path(mock, V1_2_3, TARGET);

        assert_eq!(query(SEALED, &[], set), returns(&word_u128(0)));
        assert_eq!(
            query(versioning::shim::RESOLVER, &[], unset),
            returns(&word_addr(RESOLVER))
        );
        // Bytes after the selector change nothing.
        assert_eq!(query(SEALED, &[0xFF; 5], set), returns(&word_u128(0)));
    }

    // ─── Sealed ──────────────────────────────────────────────────────────

    #[test]
    fn sealed_shim_keeps_serving_plain_and_sealed_key_calls() {
        let (mut shim, mock) = deployed(&CALLDATA, 0, Err(()));
        store_sealed(&mock, V1_2_3, TARGET);
        assert!(shim.fallback().is_ok());
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(TARGET, CALLDATA.to_vec())]
        );

        let (mut shim, mock) = deployed(&versioned(V1_2_3, &INNER), 0, Err(()));
        store_sealed(&mock, V1_2_3, TARGET);
        assert!(shim.fallback().is_ok());
        assert_eq!(mock.take_recorded_calls(), vec![(TARGET, INNER.to_vec())]);
    }

    #[test]
    fn sealed_shim_reverts_everything_else_without_asking_the_resolver() {
        for calldata in [
            versioned(V2_0_0, &INNER),
            // The sealed key with the flag's bit set is another key.
            versioned(V1_2_3 | 1 << 95, &INNER),
            meta_call(meta::FROZEN, &[]),
            meta_call(meta::CALL_CODE, &word_addr(OTHER_TARGET)),
            MAGIC.to_vec(),
        ] {
            let (mut shim, mock) =
                deployed(&calldata, 0, resolution(resolve::RETURN, [0u8; 20], 0, &[]));
            store_sealed(&mock, V1_2_3, TARGET);
            assert!(matches!(shim.fallback(), Err(Error::Sealed(_))));
            assert!(mock.take_recorded_calls().is_empty());
        }
    }

    #[test]
    fn sealed_flag_without_an_implementation_never_asks_the_resolver() {
        let flag_only = |mock: &MockHost| {
            let mut word = [0u8; 32];
            word[0] = SEALED_FLAG;
            mock.set_raw_storage(FAST_SLOT.to_vec(), word.to_vec());
        };
        assert_eq!(query(SEALED, &[], flag_only), returns(&word_u128(1)));

        for calldata in [
            CALLDATA.to_vec(),
            versioned(V1_2_3, &INNER),
            meta_call(meta::LATEST, &[]),
            meta_call(meta::CALL_CODE, &word_addr(OTHER_TARGET)),
        ] {
            let (mut shim, mock) =
                deployed(&calldata, 0, resolution(resolve::RETURN, [0u8; 20], 0, &[]));
            flag_only(&mock);
            assert!(matches!(shim.fallback(), Err(Error::Sealed(_))));
            assert!(mock.take_recorded_calls().is_empty());
        }
    }

    #[test]
    fn sealed_shim_still_answers_its_getters() {
        let sealed = |mock: &MockHost| store_sealed(mock, V1_2_3, TARGET);

        assert_eq!(
            query(meta::LATEST, &[], sealed),
            returns(&[word_u128(V1_2_3), word_addr(TARGET)].concat())
        );
        assert_eq!(query(SEALED, &[], sealed), returns(&word_u128(1)));
        assert_eq!(
            query(versioning::shim::RESOLVER, &[], sealed),
            returns(&word_addr(RESOLVER))
        );
    }

    // ─── setFastPath and seal ────────────────────────────────────────────

    /// A shim about to receive `selector(key, implementation)` from `caller`.
    fn written_by(
        caller: [u8; 20],
        selector: [u8; 4],
        key: u128,
        implementation: [u8; 20],
    ) -> (ContractProxy, MockHost) {
        let calldata = meta_call(selector, &fast_path_args(key, implementation));
        deployed_as(caller, &calldata, 0, Err(()))
    }

    #[test]
    fn set_fast_path_from_the_resolver_stores_the_word() {
        let (mut shim, mock) = written_by(RESOLVER, SET_FAST_PATH, V1_2_3, TARGET);
        assert!(shim.fallback().is_ok());

        assert_eq!(
            mock.get_raw_storage(&FAST_SLOT),
            Some(pack_fast_path(V1_2_3, &TARGET, false).to_vec())
        );
        assert_eq!(mock.take_return_value(), returns(&[]));
        assert!(mock.take_recorded_calls().is_empty());
    }

    #[test]
    fn set_fast_path_with_a_zero_implementation_clears_the_slot() {
        // Whatever key comes with it.
        for key in [0, V2_0_0] {
            let (mut shim, mock) = written_by(RESOLVER, SET_FAST_PATH, key, [0u8; 20]);
            store_fast_path(&mock, V1_2_3, TARGET);
            assert!(shim.fallback().is_ok());
            assert_eq!(mock.get_raw_storage(&FAST_SLOT), None);
        }
    }

    #[test]
    fn seal_from_the_resolver_stores_the_word_with_the_flag() {
        let (mut shim, mock) = written_by(RESOLVER, SEAL, V1_2_3, TARGET);
        assert!(shim.fallback().is_ok());

        assert_eq!(
            mock.get_raw_storage(&FAST_SLOT),
            Some(pack_fast_path(V1_2_3, &TARGET, true).to_vec())
        );
        assert_eq!(mock.take_return_value(), returns(&[]));
    }

    #[test]
    fn writes_are_resolver_only() {
        for selector in [SET_FAST_PATH, SEAL] {
            let (mut shim, _mock) = written_by(CALLER, selector, V1_2_3, TARGET);
            assert!(matches!(shim.fallback(), Err(Error::NotResolver(_))));

            // Checked before anything else: sealed, with no arguments at all.
            let (mut shim, mock) = deployed(&meta_call(selector, &[]), 0, Err(()));
            store_sealed(&mock, V1_2_3, TARGET);
            assert!(matches!(shim.fallback(), Err(Error::NotResolver(_))));
        }
    }

    #[test]
    fn writes_revert_once_sealed() {
        for selector in [SET_FAST_PATH, SEAL] {
            let (mut shim, mock) = written_by(RESOLVER, selector, V2_0_0, OTHER_TARGET);
            store_sealed(&mock, V1_2_3, TARGET);
            assert!(matches!(shim.fallback(), Err(Error::Sealed(_))));

            // Checked before the arguments are read.
            let (mut shim, mock) = deployed_as(RESOLVER, &meta_call(selector, &[]), 0, Err(()));
            store_sealed(&mock, V1_2_3, TARGET);
            assert!(matches!(shim.fallback(), Err(Error::Sealed(_))));
        }
    }

    #[test]
    fn writes_reject_bad_arguments() {
        let good = fast_path_args(V1_2_3, TARGET);
        let mut padded_key = good.clone();
        padded_key[15] = 1;
        let mut padded_address = good.clone();
        padded_address[43] = 1;
        let bad = [
            ("a truncated word", good[..63].to_vec()),
            ("padding in the key word", padded_key),
            ("padding in the address word", padded_address),
            ("the reserved key", fast_path_args(0, TARGET)),
            ("a key past 95 bits", fast_path_args(1 << 95, TARGET)),
        ];
        for selector in [SET_FAST_PATH, SEAL] {
            for (what, args) in &bad {
                let (mut shim, _mock) =
                    deployed_as(RESOLVER, &meta_call(selector, args), 0, Err(()));
                assert!(
                    matches!(shim.fallback(), Err(Error::MalformedCall(_))),
                    "{what}"
                );
            }
        }

        // `seal` never takes the zero implementation `setFastPath` clears with.
        let (mut shim, _mock) = written_by(RESOLVER, SEAL, V1_2_3, [0u8; 20]);
        assert!(matches!(shim.fallback(), Err(Error::MalformedCall(_))));
    }

    #[test]
    fn writes_ignore_bytes_after_their_arguments() {
        let mut args = fast_path_args(V1_2_3, TARGET);
        args.extend_from_slice(&[0xFF; 7]);
        let (mut shim, mock) = deployed_as(RESOLVER, &meta_call(SET_FAST_PATH, &args), 0, Err(()));
        assert!(shim.fallback().is_ok());
        assert_eq!(
            mock.get_raw_storage(&FAST_SLOT),
            Some(pack_fast_path(V1_2_3, &TARGET, false).to_vec())
        );
    }
}
