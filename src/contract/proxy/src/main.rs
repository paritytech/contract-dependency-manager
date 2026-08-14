//! Per-name CDM proxy.
//!
//! One instance of this contract is deployed by the registry for every
//! published name. It owns the name's stable address, its storage, and its
//! balance; semver versions are implementation contracts it delegate-calls,
//! so every version runs against this single storage. The proxy declares no
//! methods — the contract's own ABI passes through untouched — and reserves
//! exactly one calldata pattern, the `MAGIC`-prefixed CDM wire format
//! (`contract_registry_core::versioning`):
//!
//! - plain calldata → delegate to the latest implementation;
//! - `[MAGIC][version key]…` → delegate to that exact version;
//! - `[MAGIC][0][meta selector]…` → CDM queries and registry-only admin ops.
//!
//! The registry instantiates the proxy with no constructor input (keeping the
//! CREATE2 address a pure function of registry, name, and this blob) and
//! becomes its admin as the instantiation caller.

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// polkavm-linker defaults guest stacks to 8 KiB, which deep call chains
// overflow as a raw VM trap. Match resolc's production default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

// Bump allocator: the routing frame makes a handful of one-shot
// allocations (calldata/returndata copies, meta words) and never frees —
// bump is smaller and simpler than picoalloc for that profile, and the
// implementations it delegates to bring their own allocators anyway.
#[pvm_contract_sdk::contract(allocator = "bump", allocator_size = 262144)]
mod contract_proxy {
    use alloc::vec;
    use contract_registry_core::slots::{
        ADMIN_SLOT, IMPL_OF_SLOT, IMPLEMENTATION_SLOT, LATEST_KEY_SLOT, MIN_SUPPORTED_SLOT,
        PROXY_FROZEN_SLOT,
    };
    use contract_registry_core::versioning::{
        CallRoute, META_HEADER_LEN, VERSIONED_HEADER_LEN, is_publishable_key, meta, route_calldata,
    };
    use pvm_contract_sdk::{Address, CallFlags, HostApi, Lazy, Mapping, SolError};

    /// EIP-1967 standard event, emitted on every publish (the latest
    /// implementation is this proxy's EIP-1967 implementation), so
    /// proxy-aware tooling sees upgrades without knowing about CDM.
    #[derive(pvm_contract_sdk::SolEvent)]
    pub struct Upgraded {
        #[indexed]
        pub implementation: Address,
    }

    /// Versioned call for a key that was never published.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct UnknownVersion;

    /// Versioned call below the owner's minimum supported floor.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct UnsupportedVersion {
        pub requested: u128,
        pub min_supported: u128,
    }

    /// Meta admin operation from anyone but the registry.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct UnauthorizedAdmin;

    /// Published keys must be strictly increasing.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct VersionNotMonotonic {
        pub attempted: u128,
        pub latest: u128,
    }

    /// Key is zero (reserved) or not a packed semver triple.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct InvalidVersionKey;

    /// Publish target is the zero address.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct InvalidImplementation;

    /// Magic-prefixed calldata too short for any CDM form, or meta args that
    /// don't decode.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct MalformedCall;

    /// Meta call with an unrecognized selector.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct UnknownMetaSelector;

    /// The min-supported floor only ratchets up.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct MinNotMonotonic {
        pub requested: u128,
        pub current: u128,
    }

    /// The min-supported floor cannot exceed the latest published version.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct MinAboveLatest {
        pub requested: u128,
        pub latest: u128,
    }

    /// Call arrived before the first publish (only possible inside the
    /// registry's first-publish transaction).
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct NoVersions;

    /// The owner has frozen the contract: no calls are delegated until
    /// `unfreeze`. The meta plane keeps answering.
    #[derive(Debug, PartialEq, Eq, SolError)]
    pub struct ContractFrozen;

    #[derive(Debug, PartialEq, Eq, SolError)]
    pub enum Error {
        UnknownVersion(UnknownVersion),
        UnsupportedVersion(UnsupportedVersion),
        UnauthorizedAdmin(UnauthorizedAdmin),
        VersionNotMonotonic(VersionNotMonotonic),
        InvalidVersionKey(InvalidVersionKey),
        InvalidImplementation(InvalidImplementation),
        MalformedCall(MalformedCall),
        UnknownMetaSelector(UnknownMetaSelector),
        MinNotMonotonic(MinNotMonotonic),
        MinAboveLatest(MinAboveLatest),
        NoVersions(NoVersions),
        ContractFrozen(ContractFrozen),
    }

    pub struct ContractProxy {
        /// No ordinary fields: slots 0.. belong to the implementations'
        /// storage, reached through `delegate_call`. Everything the proxy
        /// owns lives at fixed pseudo-random slots.
        #[slot(raw = IMPLEMENTATION_SLOT)]
        latest_impl: Lazy<Address>,
        #[slot(raw = ADMIN_SLOT)]
        admin: Lazy<Address>,
        /// Floor version key; versioned calls below it revert
        /// `UnsupportedVersion`. Zero = no floor.
        #[slot(raw = MIN_SUPPORTED_SLOT)]
        min_supported: Lazy<u128>,
        /// Latest published key, for the monotonic publish check and the
        /// `latest()` meta query. Zero before the first publish.
        #[slot(raw = LATEST_KEY_SLOT)]
        latest_key: Lazy<u128>,
        /// Owner-controlled freeze: while set, nothing is delegated —
        /// the pause switch for storage migrations.
        #[slot(raw = PROXY_FROZEN_SLOT)]
        frozen: Lazy<bool>,
        /// Version key → implementation, the routing table.
        #[slot(raw = IMPL_OF_SLOT)]
        impl_of: Mapping<u128, Address>,
    }

    impl ContractProxy {
        /// No arguments: the CREATE2 address must be a pure function of
        /// (registry, name, blob), and the registry — the instantiation
        /// caller — is exactly the admin we want.
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            self.admin.set(&Address(caller));
        }

        /// The proxy declares no methods, so every call lands here. Payable:
        /// implementations may take value, which accrues to this address.
        #[pvm_contract_sdk::fallback]
        #[pvm_contract_sdk::payable]
        pub fn fallback(&mut self) -> Result<(), Error> {
            let host = self.host();
            let input_len = host.call_data_size() as usize;
            let mut input = vec![0u8; input_len];
            host.call_data_copy(&mut input, 0);

            match route_calldata(&input) {
                CallRoute::Plain => {
                    self.require_unfrozen()?;
                    let target = self.latest_impl.get();
                    if target == Address::ZERO {
                        return Err(NoVersions.into());
                    }
                    self.delegate(&target, &input)
                }
                CallRoute::Versioned(key) => {
                    self.require_unfrozen()?;
                    let min_supported = self.min_supported.get();
                    if key < min_supported {
                        return Err(UnsupportedVersion {
                            requested: key,
                            min_supported,
                        }
                        .into());
                    }
                    let target = self.impl_of.get(&key);
                    if target == Address::ZERO {
                        return Err(UnknownVersion.into());
                    }
                    self.delegate(&target, &input[VERSIONED_HEADER_LEN..])
                }
                CallRoute::Meta(selector) => {
                    self.dispatch_meta(selector, &input[META_HEADER_LEN..])
                }
                CallRoute::Malformed => Err(MalformedCall.into()),
            }
        }

        // ─── Delegation ──────────────────────────────────────────────────

        /// Delegate-call `target` and bubble its return or revert unchanged.
        fn delegate(&mut self, target: &Address, input: &[u8]) -> Result<(), Error> {
            let host = self.host();
            let result =
                host.delegate_call_evm(CallFlags::empty(), &target.0, u64::MAX, input, None);

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

        // ─── Meta dispatch ───────────────────────────────────────────────

        fn dispatch_meta(&mut self, selector: [u8; 4], args: &[u8]) -> Result<(), Error> {
            match selector {
                meta::IMPL_OF => {
                    let key = u128_arg(args, 0)?;
                    self.respond(&word_address(&self.impl_of.get(&key)))
                }
                meta::LATEST => {
                    let key = self.latest_key.get();
                    if key == 0 {
                        return Err(NoVersions.into());
                    }
                    let mut out = [0u8; 64];
                    out[..32].copy_from_slice(&word_u128(key));
                    out[32..].copy_from_slice(&word_address(&self.latest_impl.get()));
                    self.respond(&out)
                }
                meta::MIN_SUPPORTED => self.respond(&word_u128(self.min_supported.get())),
                meta::ADMIN => self.respond(&word_address(&self.admin.get())),
                meta::PUBLISH => {
                    self.require_admin()?;
                    let key = u128_arg(args, 0)?;
                    let implementation = address_arg(args, 1)?;
                    self.publish(key, implementation)?;
                    self.respond(&[])
                }
                meta::SET_MIN_SUPPORTED => {
                    self.require_admin()?;
                    let key = u128_arg(args, 0)?;
                    self.set_min_supported(key)?;
                    self.respond(&[])
                }
                meta::FROZEN => self.respond(&word_bool(self.frozen.get())),
                meta::FREEZE => {
                    self.require_admin()?;
                    self.frozen.set(&true);
                    self.respond(&[])
                }
                meta::UNFREEZE => {
                    self.require_admin()?;
                    self.frozen.set(&false);
                    self.respond(&[])
                }
                meta::SET_ADMIN => {
                    self.require_admin()?;
                    let new_admin = address_arg(args, 0)?;
                    // A zero admin would orphan the proxy forever.
                    if new_admin == Address::ZERO {
                        return Err(MalformedCall.into());
                    }
                    self.admin.set(&new_admin);
                    self.respond(&[])
                }
                _ => Err(UnknownMetaSelector.into()),
            }
        }

        fn publish(&mut self, key: u128, implementation: Address) -> Result<(), Error> {
            if !is_publishable_key(key) {
                return Err(InvalidVersionKey.into());
            }
            if implementation == Address::ZERO {
                return Err(InvalidImplementation.into());
            }
            let latest = self.latest_key.get();
            if key <= latest && latest != 0 {
                return Err(VersionNotMonotonic {
                    attempted: key,
                    latest,
                }
                .into());
            }
            self.latest_key.set(&key);
            self.impl_of.insert(&key, &implementation);
            self.latest_impl.set(&implementation);
            Upgraded { implementation }.emit(self.host());
            Ok(())
        }

        fn set_min_supported(&mut self, key: u128) -> Result<(), Error> {
            if key >> 96 != 0 {
                return Err(InvalidVersionKey.into());
            }
            let current = self.min_supported.get();
            if key < current {
                return Err(MinNotMonotonic {
                    requested: key,
                    current,
                }
                .into());
            }
            let latest = self.latest_key.get();
            if latest == 0 {
                return Err(NoVersions.into());
            }
            if key > latest {
                return Err(MinAboveLatest {
                    requested: key,
                    latest,
                }
                .into());
            }
            self.min_supported.set(&key);
            Ok(())
        }

        // ─── Internals ───────────────────────────────────────────────────

        fn require_unfrozen(&self) -> Result<(), Error> {
            if self.frozen.get() {
                return Err(ContractFrozen.into());
            }
            Ok(())
        }

        fn require_admin(&self) -> Result<(), Error> {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            if Address(caller) != self.admin.get() {
                return Err(UnauthorizedAdmin.into());
            }
            Ok(())
        }

        /// Return ABI-encoded meta output; mirrors `delegate`'s divergence.
        fn respond(&self, data: &[u8]) -> Result<(), Error> {
            self.host().return_value(data);
            #[cfg(not(target_arch = "riscv64"))]
            Ok(())
        }
    }

    // ─── ABI word helpers (meta args are plain 32-byte ABI words) ────────

    fn word_at(args: &[u8], index: usize) -> Result<&[u8], Error> {
        let start = index * 32;
        args.get(start..start + 32)
            .ok_or_else(|| MalformedCall.into())
    }

    fn u128_arg(args: &[u8], index: usize) -> Result<u128, Error> {
        let word = word_at(args, index)?;
        if word[..16] != [0u8; 16] {
            return Err(MalformedCall.into());
        }
        let mut bytes = [0u8; 16];
        bytes.copy_from_slice(&word[16..]);
        Ok(u128::from_be_bytes(bytes))
    }

    fn address_arg(args: &[u8], index: usize) -> Result<Address, Error> {
        let word = word_at(args, index)?;
        if word[..12] != [0u8; 12] {
            return Err(MalformedCall.into());
        }
        let mut bytes = [0u8; 20];
        bytes.copy_from_slice(&word[12..]);
        Ok(Address(bytes))
    }

    fn word_u128(value: u128) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[16..].copy_from_slice(&value.to_be_bytes());
        word
    }

    fn word_address(address: &Address) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address.0);
        word
    }

    fn word_bool(value: bool) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[31] = value as u8;
        word
    }
}

/// Host-side unit tests. Everything goes through `fallback()` with staged
/// calldata — exactly how calls arrive on-chain — so these lock the wire
/// format as well as the behavior.
#[cfg(test)]
mod tests {
    use super::contract_proxy::{ContractProxy, Error};
    use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT, MIN_SUPPORTED_SLOT};
    use contract_registry_core::versioning::{MAGIC, META_KEY, meta, pack_version};
    use pvm_contract_sdk::{
        MockHost, MockHostBuilder, ReturnFlags, SolError, keccak256, types::ReturnValue,
    };

    /// The registry proxy address — instantiation caller, therefore admin.
    const REGISTRY: [u8; 20] = [0x9E; 20];
    const STRANGER: [u8; 20] = [0x57; 20];
    const IMPL_1: [u8; 20] = [0x11; 20];
    const IMPL_2: [u8; 20] = [0x22; 20];
    const IMPL_3: [u8; 20] = [0x33; 20];

    const V0_1_0: u128 = pack_version(0, 1, 0);
    const V1_0_0: u128 = pack_version(1, 0, 0);
    const V1_2_3: u128 = pack_version(1, 2, 3);
    const V2_0_0: u128 = pack_version(2, 0, 0);

    // ─── Wire helpers ────────────────────────────────────────────────────

    fn versioned_calldata(key: u128, inner: &[u8]) -> Vec<u8> {
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&key.to_be_bytes());
        data.extend_from_slice(inner);
        data
    }

    fn meta_calldata(selector: [u8; 4], args: &[u8]) -> Vec<u8> {
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&META_KEY.to_be_bytes());
        data.extend_from_slice(&selector);
        data.extend_from_slice(args);
        data
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

    fn publish_args(key: u128, implementation: [u8; 20]) -> Vec<u8> {
        let mut args = word_u128(key).to_vec();
        args.extend_from_slice(&word_addr(implementation));
        args
    }

    // ─── Host plumbing ───────────────────────────────────────────────────

    /// A proxy freshly constructed by `caller`, with `calldata` staged for
    /// `fallback()` and `storage` carried over from a previous host (the
    /// MockHost caller/calldata are fixed at build time).
    fn proxy_call(
        caller: [u8; 20],
        calldata: Vec<u8>,
        storage: Option<&MockHost>,
    ) -> (ContractProxy, MockHost) {
        let mock = MockHostBuilder::new()
            .caller(caller)
            .calldata(calldata)
            .build();
        if let Some(prev) = storage {
            for (key, value) in prev.storage_dump() {
                mock.set_raw_storage(key, value);
            }
        }
        let mut proxy = ContractProxy::with_host(mock.clone());
        if storage.is_none() {
            proxy.new();
        }
        (proxy, mock)
    }

    /// Run one fallback invocation against carried-over storage and return
    /// the resulting host for further chaining.
    fn run(
        caller: [u8; 20],
        calldata: Vec<u8>,
        storage: Option<&MockHost>,
    ) -> (Result<(), Error>, MockHost) {
        let (mut proxy, mock) = proxy_call(caller, calldata, storage);
        let result = proxy.fallback();
        (result, mock)
    }

    /// A proxy with versions published (as the registry would immediately
    /// after instantiation). Returns the host carrying the state.
    fn published(versions: &[(u128, [u8; 20])]) -> MockHost {
        let (_proxy, mut mock) = proxy_call(REGISTRY, vec![], None);
        for (key, implementation) in versions {
            let calldata = meta_calldata(meta::PUBLISH, &publish_args(*key, *implementation));
            let (result, next) = run(REGISTRY, calldata, Some(&mock));
            assert_eq!(result, Ok(()), "test setup publish failed");
            mock = next;
        }
        mock
    }

    // ─── Constructor ─────────────────────────────────────────────────────

    #[test]
    fn constructor_pins_admin_from_caller() {
        let (_proxy, mock) = proxy_call(REGISTRY, vec![], None);
        assert_eq!(
            mock.get_raw_storage(&ADMIN_SLOT),
            Some(word_addr(REGISTRY).to_vec())
        );
        // No implementation yet: the slot is untouched until first publish.
        assert_eq!(mock.get_raw_storage(&IMPLEMENTATION_SLOT), None);
    }

    // ─── Plain calls ─────────────────────────────────────────────────────

    #[test]
    fn plain_call_delegates_to_latest_and_bubbles_return() {
        let state = published(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        // Arbitrary user-ABI calldata; the proxy must not interpret it.
        let calldata: Vec<u8> = [0xbf, 0x40, 0xfa, 0xc1]
            .into_iter()
            .chain([0x77; 32])
            .collect();

        let (_proxy, mock) = proxy_call(STRANGER, calldata.clone(), Some(&state));
        let payload = vec![0xEE; 96];
        mock.mock_call(IMPL_2, Ok(payload.clone()));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());

        assert_eq!(mock.take_recorded_calls(), vec![(IMPL_2, calldata)]);
        assert_eq!(
            mock.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: payload,
            })
        );
    }

    #[test]
    fn plain_call_bubbles_callee_revert() {
        let state = published(&[(V1_0_0, IMPL_1)]);
        let (_proxy, mock) = proxy_call(STRANGER, vec![1, 2, 3, 4], Some(&state));
        mock.mock_call(IMPL_1, Err(()));
        let mut proxy = ContractProxy::with_host(mock.clone());

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
    }

    #[test]
    fn plain_call_before_first_publish_reverts_no_versions() {
        let (result, _mock) = run(STRANGER, vec![0xAA, 0xBB, 0xCC, 0xDD], None);
        assert!(matches!(result, Err(Error::NoVersions(_))));
    }

    #[test]
    fn empty_calldata_routes_to_latest() {
        // Bare transfers / receive-style calls pass through to the latest
        // implementation's own no-selector handling.
        let state = published(&[(V1_0_0, IMPL_1)]);
        let (_proxy, mock) = proxy_call(STRANGER, vec![], Some(&state));
        mock.mock_call(IMPL_1, Ok(vec![]));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        assert_eq!(mock.take_recorded_calls(), vec![(IMPL_1, vec![])]);
    }

    // ─── Versioned calls ─────────────────────────────────────────────────

    #[test]
    fn versioned_call_routes_to_exact_version_with_inner_calldata() {
        let state = published(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2), (V2_0_0, IMPL_3)]);
        let inner: Vec<u8> = [0xde, 0xad, 0xbe, 0xef]
            .into_iter()
            .chain([0x01; 32])
            .collect();

        // Pinned to 1.2.3 — not latest, not first.
        let (_proxy, mock) = proxy_call(STRANGER, versioned_calldata(V1_2_3, &inner), Some(&state));
        mock.mock_call(IMPL_2, Ok(vec![0x42]));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());

        // The implementation sees ONLY the inner calldata — prefix stripped.
        assert_eq!(mock.take_recorded_calls(), vec![(IMPL_2, inner)]);
        assert_eq!(
            mock.take_return_value(),
            Some(ReturnValue {
                flags: ReturnFlags::empty(),
                data: vec![0x42],
            })
        );
    }

    #[test]
    fn versioned_call_unknown_key_reverts() {
        let state = published(&[(V1_0_0, IMPL_1)]);
        let (result, _mock) = run(STRANGER, versioned_calldata(V1_2_3, &[0x01]), Some(&state));
        assert!(matches!(result, Err(Error::UnknownVersion(_))));
    }

    #[test]
    fn versioned_call_below_min_supported_reverts() {
        let state = published(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        let (result, state) = run(
            REGISTRY,
            meta_calldata(meta::SET_MIN_SUPPORTED, &word_u128(V1_2_3)),
            Some(&state),
        );
        assert_eq!(result, Ok(()));

        let (result, _mock) = run(STRANGER, versioned_calldata(V1_0_0, &[0x01]), Some(&state));
        match result {
            Err(Error::UnsupportedVersion(e)) => {
                assert_eq!(e.requested, V1_0_0);
                assert_eq!(e.min_supported, V1_2_3);
            }
            other => panic!("expected UnsupportedVersion, got {other:?}"),
        }
    }

    #[test]
    fn versioned_call_at_or_above_min_supported_works() {
        let state = published(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        let (result, state) = run(
            REGISTRY,
            meta_calldata(meta::SET_MIN_SUPPORTED, &word_u128(V1_2_3)),
            Some(&state),
        );
        assert_eq!(result, Ok(()));

        let (_proxy, mock) =
            proxy_call(STRANGER, versioned_calldata(V1_2_3, &[0x01]), Some(&state));
        mock.mock_call(IMPL_2, Ok(vec![]));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        assert_eq!(mock.take_recorded_calls(), vec![(IMPL_2, vec![0x01])]);
    }

    #[test]
    fn versioned_call_bubbles_callee_revert() {
        let state = published(&[(V1_0_0, IMPL_1)]);
        let (_proxy, mock) =
            proxy_call(STRANGER, versioned_calldata(V1_0_0, &[0x09]), Some(&state));
        mock.mock_call(IMPL_1, Err(()));
        let mut proxy = ContractProxy::with_host(mock.clone());

        let rv = mock.expect_revert(|| {
            let _ = proxy.fallback();
        });
        assert_eq!(rv.flags, ReturnFlags::REVERT);
    }

    // ─── Publish rules ───────────────────────────────────────────────────

    #[test]
    fn publish_appends_updates_latest_and_emits_upgraded() {
        let (_proxy, mock) = proxy_call(REGISTRY, vec![], None);
        let (result, mock) = run(
            REGISTRY,
            meta_calldata(meta::PUBLISH, &publish_args(V1_0_0, IMPL_1)),
            Some(&mock),
        );
        assert_eq!(result, Ok(()));

        // EIP-1967 implementation slot now carries the latest impl.
        assert_eq!(
            mock.get_raw_storage(&IMPLEMENTATION_SLOT),
            Some(word_addr(IMPL_1).to_vec())
        );
        // Standard Upgraded(address) event, implementation indexed.
        let events = mock.events();
        assert_eq!(events.len(), 1);
        let (topics, data) = &events[0];
        assert_eq!(topics[0], keccak256(b"Upgraded(address)"));
        assert_eq!(topics[1], word_addr(IMPL_1));
        assert!(data.is_empty());
    }

    #[test]
    fn publish_requires_strictly_increasing_keys() {
        let state = published(&[(V1_0_0, IMPL_1)]);

        // Re-publish of the same key: rejected forever.
        let (result, _mock) = run(
            REGISTRY,
            meta_calldata(meta::PUBLISH, &publish_args(V1_0_0, IMPL_2)),
            Some(&state),
        );
        match result {
            Err(Error::VersionNotMonotonic(e)) => {
                assert_eq!(e.attempted, V1_0_0);
                assert_eq!(e.latest, V1_0_0);
            }
            other => panic!("expected VersionNotMonotonic, got {other:?}"),
        }

        // Lower than latest: rejected.
        let (result, _mock) = run(
            REGISTRY,
            meta_calldata(meta::PUBLISH, &publish_args(V0_1_0, IMPL_2)),
            Some(&state),
        );
        assert!(matches!(result, Err(Error::VersionNotMonotonic(_))));
    }

    #[test]
    fn publish_rejects_invalid_keys_and_zero_impl() {
        let (_proxy, mock) = proxy_call(REGISTRY, vec![], None);

        // Key zero is the reserved meta namespace... and also unreachable by
        // construction (key 0 routes as a meta call), so a high-bits key is
        // the observable invalid-key case.
        let bad_key = 1u128 << 96;
        let (result, _m) = run(
            REGISTRY,
            meta_calldata(meta::PUBLISH, &publish_args(bad_key, IMPL_1)),
            Some(&mock),
        );
        assert!(matches!(result, Err(Error::InvalidVersionKey(_))));

        let (result, _m) = run(
            REGISTRY,
            meta_calldata(meta::PUBLISH, &publish_args(V1_0_0, [0u8; 20])),
            Some(&mock),
        );
        assert!(matches!(result, Err(Error::InvalidImplementation(_))));
    }

    #[test]
    fn admin_ops_require_registry_caller() {
        let state = published(&[(V1_0_0, IMPL_1)]);
        for calldata in [
            meta_calldata(meta::PUBLISH, &publish_args(V2_0_0, IMPL_2)),
            meta_calldata(meta::SET_MIN_SUPPORTED, &word_u128(V1_0_0)),
            meta_calldata(meta::SET_ADMIN, &word_addr(STRANGER)),
        ] {
            let (result, _mock) = run(STRANGER, calldata, Some(&state));
            assert!(matches!(result, Err(Error::UnauthorizedAdmin(_))));
        }
    }

    // ─── Min-supported ratchet ───────────────────────────────────────────

    #[test]
    fn min_supported_only_ratchets_up_and_stays_at_or_below_latest() {
        let state = published(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);

        let (result, state) = run(
            REGISTRY,
            meta_calldata(meta::SET_MIN_SUPPORTED, &word_u128(V1_2_3)),
            Some(&state),
        );
        assert_eq!(result, Ok(()));
        assert_eq!(
            state.get_raw_storage(&MIN_SUPPORTED_SLOT),
            Some(word_u128(V1_2_3).to_vec())
        );

        // Lowering the floor is refused.
        let (result, state) = run(
            REGISTRY,
            meta_calldata(meta::SET_MIN_SUPPORTED, &word_u128(V1_0_0)),
            Some(&state),
        );
        match result {
            Err(Error::MinNotMonotonic(e)) => {
                assert_eq!(e.requested, V1_0_0);
                assert_eq!(e.current, V1_2_3);
            }
            other => panic!("expected MinNotMonotonic, got {other:?}"),
        }

        // A floor above the latest published version is refused.
        let (result, _state) = run(
            REGISTRY,
            meta_calldata(meta::SET_MIN_SUPPORTED, &word_u128(V2_0_0)),
            Some(&state),
        );
        assert!(matches!(result, Err(Error::MinAboveLatest(_))));
    }

    // ─── Meta queries ────────────────────────────────────────────────────

    #[test]
    fn meta_queries_return_abi_words() {
        let state = published(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);

        // Point lookup of a non-latest version — the routing table.
        let (_proxy, mock) = proxy_call(
            STRANGER,
            meta_calldata(meta::IMPL_OF, &word_u128(V1_0_0)),
            Some(&state),
        );
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        assert_eq!(
            mock.take_return_value().unwrap().data,
            word_addr(IMPL_1).to_vec()
        );

        let (_proxy, mock) = proxy_call(
            STRANGER,
            meta_calldata(meta::IMPL_OF, &word_u128(V1_2_3)),
            Some(&state),
        );
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        assert_eq!(
            mock.take_return_value().unwrap().data,
            word_addr(IMPL_2).to_vec()
        );

        let (_proxy, mock) = proxy_call(STRANGER, meta_calldata(meta::LATEST, &[]), Some(&state));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        let mut expected = word_u128(V1_2_3).to_vec();
        expected.extend_from_slice(&word_addr(IMPL_2));
        assert_eq!(mock.take_return_value().unwrap().data, expected);

        let (_proxy, mock) = proxy_call(STRANGER, meta_calldata(meta::ADMIN, &[]), Some(&state));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        assert_eq!(
            mock.take_return_value().unwrap().data,
            word_addr(REGISTRY).to_vec()
        );

        let (_proxy, mock) = proxy_call(
            STRANGER,
            meta_calldata(meta::MIN_SUPPORTED, &[]),
            Some(&state),
        );
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        assert_eq!(
            mock.take_return_value().unwrap().data,
            word_u128(0).to_vec()
        );
    }

    // ─── Admin transfer ──────────────────────────────────────────────────

    #[test]
    fn set_admin_transfers_control() {
        let state = published(&[(V1_0_0, IMPL_1)]);
        let (result, state) = run(
            REGISTRY,
            meta_calldata(meta::SET_ADMIN, &word_addr(STRANGER)),
            Some(&state),
        );
        assert_eq!(result, Ok(()));
        assert_eq!(
            state.get_raw_storage(&ADMIN_SLOT),
            Some(word_addr(STRANGER).to_vec())
        );

        // Old admin is locked out; new admin can publish.
        let (result, state) = run(
            REGISTRY,
            meta_calldata(meta::PUBLISH, &publish_args(V2_0_0, IMPL_2)),
            Some(&state),
        );
        assert!(matches!(result, Err(Error::UnauthorizedAdmin(_))));
        let (result, _state) = run(
            STRANGER,
            meta_calldata(meta::PUBLISH, &publish_args(V2_0_0, IMPL_2)),
            Some(&state),
        );
        assert_eq!(result, Ok(()));
    }

    // ─── Freeze ──────────────────────────────────────────────────────────

    #[test]
    fn freeze_blocks_delegation_but_not_the_meta_plane() {
        let state = published(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        let (result, state) = run(REGISTRY, meta_calldata(meta::FREEZE, &[]), Some(&state));
        assert_eq!(result, Ok(()));

        // Plain and versioned calls both refuse to delegate.
        let (result, state) = run(STRANGER, vec![0xAA, 0xBB, 0xCC, 0xDD], Some(&state));
        assert!(matches!(result, Err(Error::ContractFrozen(_))));
        let (result, state) = run(STRANGER, versioned_calldata(V1_0_0, &[0x01]), Some(&state));
        assert!(matches!(result, Err(Error::ContractFrozen(_))));

        // The meta plane keeps answering...
        let (_proxy, mock) = proxy_call(STRANGER, meta_calldata(meta::FROZEN, &[]), Some(&state));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        let mut frozen_word = [0u8; 32];
        frozen_word[31] = 1;
        assert_eq!(mock.take_return_value().unwrap().data, frozen_word.to_vec());

        // ... and admin operations still work: publish while frozen, unfreeze.
        let (result, state) = run(
            REGISTRY,
            meta_calldata(meta::PUBLISH, &publish_args(V2_0_0, IMPL_3)),
            Some(&mock),
        );
        assert_eq!(result, Ok(()));
        let (result, state) = run(REGISTRY, meta_calldata(meta::UNFREEZE, &[]), Some(&state));
        assert_eq!(result, Ok(()));

        // Delegation resumes at the new latest.
        let (_proxy, mock) = proxy_call(STRANGER, vec![0x01, 0x02, 0x03, 0x04], Some(&state));
        mock.mock_call(IMPL_3, Ok(vec![]));
        let mut proxy = ContractProxy::with_host(mock.clone());
        assert!(proxy.fallback().is_ok());
        assert_eq!(
            mock.take_recorded_calls(),
            vec![(IMPL_3, vec![0x01, 0x02, 0x03, 0x04])]
        );
    }

    #[test]
    fn freeze_requires_admin() {
        let state = published(&[(V1_0_0, IMPL_1)]);
        for calldata in [
            meta_calldata(meta::FREEZE, &[]),
            meta_calldata(meta::UNFREEZE, &[]),
        ] {
            let (result, _mock) = run(STRANGER, calldata, Some(&state));
            assert!(matches!(result, Err(Error::UnauthorizedAdmin(_))));
        }
    }

    // ─── Malformed input ─────────────────────────────────────────────────

    #[test]
    fn magic_prefixed_garbage_reverts_malformed() {
        let state = published(&[(V1_0_0, IMPL_1)]);
        // Magic + truncated key.
        let mut truncated = MAGIC.to_vec();
        truncated.extend_from_slice(&[0u8; 7]);
        let (result, _m) = run(STRANGER, truncated, Some(&state));
        assert!(matches!(result, Err(Error::MalformedCall(_))));

        // Meta header + selector, but args word has dirty high bytes.
        let mut dirty = word_u128(V1_0_0);
        dirty[0] = 0xFF;
        let (result, _m) = run(STRANGER, meta_calldata(meta::IMPL_OF, &dirty), Some(&state));
        assert!(matches!(result, Err(Error::MalformedCall(_))));

        // Unknown meta selector.
        let (result, _m) = run(
            STRANGER,
            meta_calldata([0xDE, 0xAD, 0xBE, 0xEF], &[]),
            Some(&state),
        );
        assert!(matches!(result, Err(Error::UnknownMetaSelector(_))));
    }

    // ─── Error selectors (TS mirrors these signatures) ───────────────────

    #[test]
    fn error_selectors_derive_from_signatures() {
        use super::contract_proxy::{UnknownVersion, UnsupportedVersion};
        fn sel(signature: &str) -> [u8; 4] {
            let hash = keccak256(signature.as_bytes());
            [hash[0], hash[1], hash[2], hash[3]]
        }
        assert_eq!(UnknownVersion::SELECTOR, sel("UnknownVersion()"));
        assert_eq!(
            UnsupportedVersion::SELECTOR,
            sel("UnsupportedVersion(uint128,uint128)")
        );
    }
}
