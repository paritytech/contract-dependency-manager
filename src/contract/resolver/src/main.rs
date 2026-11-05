//! CDM resolver — implementation contract.
//!
//! Deployed behind `contract-eip1967-proxy` with the registry as admin. It
//! owns the routing tables and policy for every per-name shim: a shim
//! forwards each call it receives as `resolve(caller, value, data)` and does
//! exactly what the answer says, so upgrading this one contract (`setCode`,
//! driven by the registry's `upgradeResolver`) reaches every name ever
//! published. Only the registry can change routing state.
//!
//! Routing is keyed by shim address (`contract_registry_core::versioning`):
//! plain calldata goes to the name's latest implementation, `[MAGIC][key]`
//! to that exact version, and `[MAGIC][0][selector]` to the CDM meta plane —
//! queries, plus `callCode`, honored only when the shim's caller is the
//! registry.

#![cfg_attr(all(not(feature = "abi-gen"), not(test)), no_main, no_std)]

// The `#[contract]` macro injects `extern crate alloc` in on-chain and test
// builds, but not in the abi-gen pass, where `types` still needs it.
#[cfg(all(feature = "abi-gen", not(test)))]
extern crate alloc;

mod types;

// polkavm-linker defaults guest stacks to 8 KiB, which deep call chains
// overflow as a raw VM trap. Match resolc's production default.
#[cfg(target_arch = "riscv64")]
polkavm_derive::min_stack_size!(131072);

// A `resolve` request carries up to 128 KiB of shim calldata, which the SDK
// copies once for dispatch and once into `data`.
#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 524288)]
mod contract_resolver {
    use super::types::*;
    use alloc::vec;
    use alloc::vec::Vec;
    use contract_registry_core::slots::{ADMIN_SLOT, IMPLEMENTATION_SLOT};
    use contract_registry_core::versioning::{
        CallRoute, META_HEADER_LEN, VERSIONED_HEADER_LEN, is_publishable_key, meta, route_calldata,
    };
    use pvm_contract_sdk::{Address, Bytes, HostApi, Lazy, Mapping, SolEncode, U256};

    pub struct ContractResolver {
        /// Shim → latest version, floor, frozen flag.
        routing: Mapping<Address, Routing>,
        /// Shim → version key → implementation.
        implementations: Mapping<Address, Mapping<u128, Address>>,
        /// Fixed-slot admin state, shared with the EIP-1967 proxy.
        #[slot(raw = IMPLEMENTATION_SLOT)]
        implementation: Lazy<Address>,
        #[slot(raw = ADMIN_SLOT)]
        admin: Lazy<Address>,
    }

    impl ContractResolver {
        /// Runs only when the implementation itself is deployed. Through the
        /// proxy, admin is initialized by the proxy's constructor instead.
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {
            let deployer = self.caller();
            self.admin.set(&deployer);
        }

        // ─── Routing ─────────────────────────────────────────────────────

        /// Route one shim call: `self.caller()` is the shim, `caller` is who
        /// called it. `value` is carried for future policy and unused today.
        #[pvm_contract_sdk::method]
        pub fn resolve(
            &self,
            caller: Address,
            value: U256,
            data: Bytes,
        ) -> Result<Resolution, Error> {
            let _ = value;
            let shim = self.caller();
            let routing = self.routing.get(&shim);
            match route_calldata(&data.0) {
                CallRoute::Plain => {
                    require_unfrozen(&routing)?;
                    if routing.latest_impl == Address::ZERO {
                        return Err(NoVersions.into());
                    }
                    Ok(Resolution::delegate(routing.latest_impl, 0))
                }
                CallRoute::Versioned(key) => {
                    require_unfrozen(&routing)?;
                    if key < routing.min_supported {
                        return Err(UnsupportedVersion {
                            requested: key,
                            min_supported: routing.min_supported,
                        }
                        .into());
                    }
                    let target = self.implementations.get(&shim).get(&key);
                    if target == Address::ZERO {
                        return Err(UnknownVersion.into());
                    }
                    Ok(Resolution::delegate(target, VERSIONED_HEADER_LEN))
                }
                CallRoute::Meta(selector) => self.resolve_meta(
                    &shim,
                    &routing,
                    caller,
                    selector,
                    &data.0[META_HEADER_LEN..],
                ),
                CallRoute::Malformed => Err(MalformedCall.into()),
            }
        }

        fn resolve_meta(
            &self,
            shim: &Address,
            routing: &Routing,
            caller: Address,
            selector: [u8; 4],
            args: &[u8],
        ) -> Result<Resolution, Error> {
            match selector {
                meta::IMPL_OF => {
                    let key = u128_arg(args, 0)?;
                    Ok(Resolution::answer(encode(
                        &self.implementations.get(shim).get(&key),
                    )))
                }
                meta::LATEST => {
                    if routing.latest_key == 0 {
                        return Err(NoVersions.into());
                    }
                    Ok(Resolution::answer(encode(&(
                        routing.latest_key,
                        routing.latest_impl,
                    ))))
                }
                meta::MIN_SUPPORTED => Ok(Resolution::answer(encode(&routing.min_supported))),
                meta::FROZEN => Ok(Resolution::answer(encode(&routing.frozen))),
                meta::ADMIN => Ok(Resolution::answer(encode(&self.admin.get()))),
                meta::CALL_CODE => {
                    // Live while frozen: the freeze → publish+init → unfreeze
                    // window depends on it.
                    if caller != self.admin.get() {
                        return Err(UnauthorizedAdmin.into());
                    }
                    let target = address_arg(args, 0)?;
                    if target == Address::ZERO {
                        return Err(InvalidImplementation.into());
                    }
                    Ok(Resolution::delegate(target, META_HEADER_LEN + 32))
                }
                _ => Err(UnknownMetaSelector.into()),
            }
        }

        // ─── Registry-only mutations ─────────────────────────────────────

        /// Register `implementation` as version `version_key` of the name
        /// behind `proxy`; keys must strictly increase.
        #[pvm_contract_sdk::method]
        pub fn publish(
            &mut self,
            proxy: Address,
            version_key: u128,
            implementation: Address,
        ) -> Result<(), Error> {
            self.require_admin()?;
            if !is_publishable_key(version_key) {
                return Err(InvalidVersionKey.into());
            }
            if implementation == Address::ZERO {
                return Err(InvalidImplementation.into());
            }
            let mut routing = self.routing.get(&proxy);
            if routing.latest_key != 0 && version_key <= routing.latest_key {
                return Err(VersionNotMonotonic {
                    attempted: version_key,
                    latest: routing.latest_key,
                }
                .into());
            }
            routing.latest_key = version_key;
            routing.latest_impl = implementation;
            self.routing.insert(&proxy, &routing);
            self.implementations
                .entry(&proxy)
                .insert(&version_key, &implementation);
            Ok(())
        }

        /// Raise the name's floor: monotonic, at most the latest key.
        #[pvm_contract_sdk::method]
        pub fn set_min_supported(
            &mut self,
            proxy: Address,
            version_key: u128,
        ) -> Result<(), Error> {
            self.require_admin()?;
            if version_key >> 96 != 0 {
                return Err(InvalidVersionKey.into());
            }
            let mut routing = self.routing.get(&proxy);
            if version_key < routing.min_supported {
                return Err(MinNotMonotonic {
                    requested: version_key,
                    current: routing.min_supported,
                }
                .into());
            }
            if routing.latest_key == 0 {
                return Err(NoVersions.into());
            }
            if version_key > routing.latest_key {
                return Err(MinAboveLatest {
                    requested: version_key,
                    latest: routing.latest_key,
                }
                .into());
            }
            routing.min_supported = version_key;
            self.routing.insert(&proxy, &routing);
            Ok(())
        }

        /// While frozen, plain and versioned calls to the name revert
        /// `ContractFrozen()`; the meta plane keeps answering.
        #[pvm_contract_sdk::method]
        pub fn set_frozen(&mut self, proxy: Address, frozen: bool) -> Result<(), Error> {
            self.require_admin()?;
            let mut routing = self.routing.get(&proxy);
            routing.frozen = frozen;
            self.routing.insert(&proxy, &routing);
            Ok(())
        }

        // ─── Admin & queries ─────────────────────────────────────────────

        /// Upgrade in place: point the proxy at a new implementation while
        /// keeping the resolver's address and routing state.
        #[pvm_contract_sdk::method]
        pub fn set_code(&mut self, new_implementation: Address) -> Result<(), Error> {
            self.require_admin()?;
            // A codeless target would strand every name. MockHost cannot
            // seed code sizes; the e2e suite covers this guard.
            #[cfg(target_arch = "riscv64")]
            if self.host().code_size(&new_implementation.0) == 0 {
                return Err(BadImplementation.into());
            }
            self.implementation.set(&new_implementation);
            Ok(())
        }

        /// The implementation the proxy currently delegates to.
        #[pvm_contract_sdk::method]
        pub fn get_code(&self) -> Address {
            self.implementation.get()
        }

        /// The registry.
        #[pvm_contract_sdk::method]
        pub fn get_admin(&self) -> Address {
            self.admin.get()
        }

        /// The name's routing state: `(latestKey, latestImpl, minSupported,
        /// frozen)`.
        #[pvm_contract_sdk::method]
        pub fn routing_of(&self, proxy: Address) -> Routing {
            self.routing.get(&proxy)
        }

        /// The implementation published under `version_key`; zero if none.
        #[pvm_contract_sdk::method]
        pub fn impl_of(&self, proxy: Address, version_key: u128) -> Address {
            self.implementations.get(&proxy).get(&version_key)
        }

        // ─── Internals ───────────────────────────────────────────────────

        fn caller(&self) -> Address {
            let mut caller = [0u8; 20];
            self.host().caller(&mut caller);
            Address(caller)
        }

        fn require_admin(&self) -> Result<(), Error> {
            if self.caller() != self.admin.get() {
                return Err(UnauthorizedAdmin.into());
            }
            Ok(())
        }
    }

    fn require_unfrozen(routing: &Routing) -> Result<(), Error> {
        if routing.frozen {
            return Err(ContractFrozen.into());
        }
        Ok(())
    }

    fn encode<T: SolEncode>(value: &T) -> Vec<u8> {
        let mut out = vec![0u8; value.encode_len()];
        value.encode_to(&mut out);
        out
    }

    // ─── Meta args (plain 32-byte ABI words) ─────────────────────────────

    /// The ABI word at `index` past its `pad` leading bytes, which must be
    /// zero.
    fn word_arg(args: &[u8], index: usize, pad: usize) -> Result<&[u8], Error> {
        let word = args.get(index * 32..index * 32 + 32).ok_or(MalformedCall)?;
        if word[..pad].iter().any(|b| *b != 0) {
            return Err(MalformedCall.into());
        }
        Ok(&word[pad..])
    }

    fn u128_arg(args: &[u8], index: usize) -> Result<u128, Error> {
        let mut bytes = [0u8; 16];
        bytes.copy_from_slice(word_arg(args, index, 16)?);
        Ok(u128::from_be_bytes(bytes))
    }

    fn address_arg(args: &[u8], index: usize) -> Result<Address, Error> {
        let mut bytes = [0u8; 20];
        bytes.copy_from_slice(word_arg(args, index, 12)?);
        Ok(Address(bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::contract_resolver::{self, ContractResolver};
    use super::types::*;
    use contract_registry_core::versioning::{
        MAGIC, META_HEADER_LEN, META_KEY, VERSIONED_HEADER_LEN, meta, pack_version, resolve,
    };
    use pvm_contract_sdk::{
        Address, Bytes, MockHost, MockHostBuilder, OutSink, Outcome, SolEncode, SolError, U256,
        const_selector,
    };

    /// The registry proxy address: admin of the resolver.
    const REGISTRY: [u8; 20] = [0x9E; 20];
    const STRANGER: [u8; 20] = [0x57; 20];
    const SHIM: [u8; 20] = [0x5A; 20];
    const OTHER_SHIM: [u8; 20] = [0x5B; 20];
    const IMPL_1: [u8; 20] = [0x11; 20];
    const IMPL_2: [u8; 20] = [0x22; 20];
    const INIT_1: [u8; 20] = [0x44; 20];

    const V0_1_0: u128 = pack_version(0, 1, 0);
    const V1_0_0: u128 = pack_version(1, 0, 0);
    const V1_2_3: u128 = pack_version(1, 2, 3);
    const V2_0_0: u128 = pack_version(2, 0, 0);

    // ─── Host plumbing ───────────────────────────────────────────────────

    fn host_with_caller(caller: [u8; 20]) -> MockHost {
        MockHostBuilder::new().caller(caller).build()
    }

    /// Constructed by the registry (admin), `versions` published for `SHIM`.
    fn deployed(versions: &[(u128, [u8; 20])]) -> (ContractResolver, MockHost) {
        let mock = host_with_caller(REGISTRY);
        let mut resolver = ContractResolver::with_host(mock.clone());
        resolver.new();
        for (key, implementation) in versions {
            resolver
                .publish(Address(SHIM), *key, Address(*implementation))
                .unwrap();
        }
        (resolver, mock)
    }

    /// Same storage, different caller (MockHost fixes the caller at build).
    fn fork_with_caller(mock: &MockHost, caller: [u8; 20]) -> ContractResolver {
        let next = host_with_caller(caller);
        for (key, value) in mock.storage_dump() {
            next.set_raw_storage(key, value);
        }
        ContractResolver::with_host(next)
    }

    /// `resolve` exactly as a shim issues it: the resolver's own caller is
    /// the shim, `caller` is whoever called the shim.
    fn resolve_as(
        mock: &MockHost,
        shim: [u8; 20],
        caller: [u8; 20],
        data: &[u8],
    ) -> Result<Resolution, Error> {
        fork_with_caller(mock, shim).resolve(Address(caller), U256::ZERO, Bytes(data.to_vec()))
    }

    fn resolve_for(mock: &MockHost, data: &[u8]) -> Result<Resolution, Error> {
        resolve_as(mock, SHIM, STRANGER, data)
    }

    fn delegate(target: [u8; 20], strip: usize) -> Result<Resolution, Error> {
        Ok(Resolution::delegate(Address(target), strip))
    }

    fn answer(payload: Vec<u8>) -> Result<Resolution, Error> {
        Ok(Resolution::answer(payload))
    }

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

    fn encode<T: SolEncode>(value: &T) -> Vec<u8> {
        let mut buf = vec![0u8; value.encode_len()];
        value.encode_to(&mut buf);
        buf
    }

    fn word_addr(address: [u8; 20]) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[12..].copy_from_slice(&address);
        word
    }

    fn word_u128(value: u128) -> [u8; 32] {
        let mut word = [0u8; 32];
        word[16..].copy_from_slice(&value.to_be_bytes());
        word
    }

    const PLAIN: [u8; 36] = [0x77; 36];

    // ─── Plain calls ─────────────────────────────────────────────────────

    #[test]
    fn plain_call_delegates_to_latest_with_nothing_stripped() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        assert_eq!(resolve_for(&mock, &PLAIN), delegate(IMPL_2, 0));
        // Empty calldata is a plain call too.
        assert_eq!(resolve_for(&mock, &[]), delegate(IMPL_2, 0));
    }

    #[test]
    fn plain_call_before_first_publish_reverts_no_versions() {
        let (_resolver, mock) = deployed(&[]);
        assert_eq!(resolve_for(&mock, &PLAIN), Err(NoVersions.into()));
    }

    #[test]
    fn routing_is_per_shim() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        assert_eq!(
            resolve_as(&mock, OTHER_SHIM, STRANGER, &PLAIN),
            Err(NoVersions.into())
        );
    }

    // ─── Versioned calls ─────────────────────────────────────────────────

    #[test]
    fn versioned_call_delegates_to_that_version_past_the_header() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2), (V2_0_0, INIT_1)]);
        assert_eq!(
            resolve_for(&mock, &versioned_calldata(V1_2_3, &[0x01; 4])),
            delegate(IMPL_2, VERSIONED_HEADER_LEN)
        );
    }

    #[test]
    fn versioned_call_unknown_key_reverts() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        assert_eq!(
            resolve_for(&mock, &versioned_calldata(V1_2_3, &[0x01])),
            Err(UnknownVersion.into())
        );
    }

    #[test]
    fn versioned_call_below_min_supported_reverts() {
        let (mut resolver, mock) = deployed(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        resolver.set_min_supported(Address(SHIM), V1_2_3).unwrap();

        assert_eq!(
            resolve_for(&mock, &versioned_calldata(V1_0_0, &[0x01])),
            Err(UnsupportedVersion {
                requested: V1_0_0,
                min_supported: V1_2_3,
            }
            .into())
        );
        assert_eq!(
            resolve_for(&mock, &versioned_calldata(V1_2_3, &[0x01])),
            delegate(IMPL_2, VERSIONED_HEADER_LEN)
        );
    }

    // ─── Publish rules ───────────────────────────────────────────────────

    #[test]
    fn publish_records_the_version_and_updates_latest() {
        let (resolver, _mock) = deployed(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        assert_eq!(
            resolver.routing_of(Address(SHIM)),
            Routing {
                latest_key: V1_2_3,
                latest_impl: Address(IMPL_2),
                min_supported: 0,
                frozen: false,
            }
        );
        assert_eq!(resolver.impl_of(Address(SHIM), V1_0_0), Address(IMPL_1));
        assert_eq!(resolver.impl_of(Address(SHIM), V2_0_0), Address::ZERO);
    }

    #[test]
    fn publish_requires_strictly_increasing_keys() {
        let (mut resolver, _mock) = deployed(&[(V1_0_0, IMPL_1)]);
        for key in [V1_0_0, V0_1_0] {
            assert_eq!(
                resolver.publish(Address(SHIM), key, Address(IMPL_2)),
                Err(VersionNotMonotonic {
                    attempted: key,
                    latest: V1_0_0,
                }
                .into())
            );
        }
    }

    #[test]
    fn publish_rejects_invalid_keys_and_zero_impl() {
        let (mut resolver, _mock) = deployed(&[]);
        for key in [0u128, 1u128 << 96] {
            assert_eq!(
                resolver.publish(Address(SHIM), key, Address(IMPL_1)),
                Err(InvalidVersionKey.into())
            );
        }
        assert_eq!(
            resolver.publish(Address(SHIM), V1_0_0, Address::ZERO),
            Err(InvalidImplementation.into())
        );
    }

    #[test]
    fn mutations_require_the_registry() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        let mut as_stranger = fork_with_caller(&mock, STRANGER);
        assert_eq!(
            as_stranger.publish(Address(SHIM), V2_0_0, Address(IMPL_2)),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(
            as_stranger.set_min_supported(Address(SHIM), V1_0_0),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(
            as_stranger.set_frozen(Address(SHIM), true),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(
            as_stranger.set_code(Address(IMPL_2)),
            Err(UnauthorizedAdmin.into())
        );
    }

    // ─── Min-supported ratchet ───────────────────────────────────────────

    #[test]
    fn min_supported_only_ratchets_up_and_stays_at_or_below_latest() {
        let (mut resolver, _mock) = deployed(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);

        assert_eq!(resolver.set_min_supported(Address(SHIM), V1_2_3), Ok(()));
        assert_eq!(resolver.routing_of(Address(SHIM)).min_supported, V1_2_3);

        assert_eq!(
            resolver.set_min_supported(Address(SHIM), V1_0_0),
            Err(MinNotMonotonic {
                requested: V1_0_0,
                current: V1_2_3,
            }
            .into())
        );
        assert_eq!(
            resolver.set_min_supported(Address(SHIM), V2_0_0),
            Err(MinAboveLatest {
                requested: V2_0_0,
                latest: V1_2_3,
            }
            .into())
        );
        assert_eq!(
            resolver.set_min_supported(Address(OTHER_SHIM), V1_0_0),
            Err(NoVersions.into())
        );
    }

    // ─── Freeze ──────────────────────────────────────────────────────────

    #[test]
    fn freeze_blocks_delegation_but_not_the_meta_plane() {
        let (mut resolver, mock) = deployed(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);
        resolver.set_frozen(Address(SHIM), true).unwrap();

        assert_eq!(resolve_for(&mock, &PLAIN), Err(ContractFrozen.into()));
        assert_eq!(
            resolve_for(&mock, &versioned_calldata(V1_0_0, &[0x01])),
            Err(ContractFrozen.into())
        );
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::FROZEN, &[])),
            answer(encode(&true))
        );

        // Publish still works while frozen; delegation resumes afterwards.
        resolver
            .publish(Address(SHIM), V2_0_0, Address(INIT_1))
            .unwrap();
        resolver.set_frozen(Address(SHIM), false).unwrap();
        assert_eq!(resolve_for(&mock, &PLAIN), delegate(INIT_1, 0));
    }

    // ─── Meta queries ────────────────────────────────────────────────────

    #[test]
    fn meta_queries_answer_with_abi_words() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1), (V1_2_3, IMPL_2)]);

        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::IMPL_OF, &word_u128(V1_0_0))),
            answer(word_addr(IMPL_1).to_vec())
        );
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::IMPL_OF, &word_u128(V2_0_0))),
            answer(word_addr([0u8; 20]).to_vec())
        );
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::LATEST, &[])),
            answer([word_u128(V1_2_3), word_addr(IMPL_2)].concat())
        );
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::MIN_SUPPORTED, &[])),
            answer(word_u128(0).to_vec())
        );
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::ADMIN, &[])),
            answer(word_addr(REGISTRY).to_vec())
        );
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::FROZEN, &[])),
            answer(encode(&false))
        );
    }

    #[test]
    fn latest_before_first_publish_reverts_no_versions() {
        let (_resolver, mock) = deployed(&[]);
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::LATEST, &[])),
            Err(NoVersions.into())
        );
    }

    // ─── callCode (the initializations primitive) ────────────────────────

    #[test]
    fn call_code_from_the_registry_delegates_past_the_target_word() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        let mut args = word_addr(INIT_1).to_vec();
        args.extend_from_slice(&[0x3a, 0x67, 0xc2, 0xf8]);
        assert_eq!(
            resolve_as(
                &mock,
                SHIM,
                REGISTRY,
                &meta_calldata(meta::CALL_CODE, &args)
            ),
            delegate(INIT_1, META_HEADER_LEN + 32)
        );
    }

    #[test]
    fn call_code_is_authorized_by_the_forwarded_caller() {
        // The resolver's own caller is always the shim; only the caller the
        // shim forwards decides.
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        let calldata = meta_calldata(meta::CALL_CODE, &word_addr(INIT_1));
        assert_eq!(
            resolve_as(&mock, SHIM, STRANGER, &calldata),
            Err(UnauthorizedAdmin.into())
        );
        assert_eq!(
            resolve_as(&mock, REGISTRY, STRANGER, &calldata),
            Err(UnauthorizedAdmin.into())
        );
    }

    #[test]
    fn call_code_works_while_frozen_and_before_first_publish() {
        let (mut resolver, mock) = deployed(&[]);
        resolver.set_frozen(Address(SHIM), true).unwrap();
        assert_eq!(
            resolve_as(
                &mock,
                SHIM,
                REGISTRY,
                &meta_calldata(meta::CALL_CODE, &word_addr(INIT_1))
            ),
            delegate(INIT_1, META_HEADER_LEN + 32)
        );
    }

    #[test]
    fn call_code_rejects_zero_and_malformed_targets() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        assert_eq!(
            resolve_as(
                &mock,
                SHIM,
                REGISTRY,
                &meta_calldata(meta::CALL_CODE, &[0u8; 32])
            ),
            Err(InvalidImplementation.into())
        );
        assert_eq!(
            resolve_as(
                &mock,
                SHIM,
                REGISTRY,
                &meta_calldata(meta::CALL_CODE, &[0u8; 31])
            ),
            Err(MalformedCall.into())
        );
        let mut dirty = word_addr(INIT_1);
        dirty[0] = 0xFF;
        assert_eq!(
            resolve_as(
                &mock,
                SHIM,
                REGISTRY,
                &meta_calldata(meta::CALL_CODE, &dirty)
            ),
            Err(MalformedCall.into())
        );
    }

    // ─── Malformed input ─────────────────────────────────────────────────

    #[test]
    fn magic_prefixed_garbage_reverts() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        let mut truncated = MAGIC.to_vec();
        truncated.extend_from_slice(&[0u8; 7]);
        assert_eq!(resolve_for(&mock, &truncated), Err(MalformedCall.into()));

        let mut dirty = word_u128(V1_0_0);
        dirty[0] = 0xFF;
        assert_eq!(
            resolve_for(&mock, &meta_calldata(meta::IMPL_OF, &dirty)),
            Err(MalformedCall.into())
        );
        assert_eq!(
            resolve_for(&mock, &meta_calldata([0xDE, 0xAD, 0xBE, 0xEF], &[])),
            Err(UnknownMetaSelector.into())
        );
    }

    // ─── setCode ─────────────────────────────────────────────────────────

    #[test]
    fn set_code_updates_the_implementation_slot() {
        let (mut resolver, _mock) = deployed(&[]);
        assert_eq!(resolver.get_admin(), Address(REGISTRY));
        assert_eq!(resolver.set_code(Address(IMPL_2)), Ok(()));
        assert_eq!(resolver.get_code(), Address(IMPL_2));
    }

    // ─── Wire format (the shim's side of the protocol) ───────────────────

    const OUT_LEN: usize = 4096;

    fn route(resolver: &mut ContractResolver, signature: &str, input: &[u8]) -> Vec<u8> {
        let mut buf = [0u8; OUT_LEN];
        let mut out: &mut [u8] = &mut buf;
        match contract_resolver::route(resolver, const_selector(signature), input, &mut out) {
            Outcome::Return(len) => out.view(len).to_vec(),
            Outcome::Unhandled => panic!("{signature} did not dispatch"),
        }
    }

    #[test]
    fn resolve_request_header_decodes_as_the_abi_arguments() {
        let (_resolver, mock) = deployed(&[(V1_0_0, IMPL_1)]);
        let mut value = [0u8; 32];
        value[31] = 9;
        let mut request = resolve::request_header(&REGISTRY, &value, PLAIN.len()).to_vec();
        request.extend_from_slice(&PLAIN);
        request.resize(
            resolve::REQUEST_HEADER_LEN + PLAIN.len().div_ceil(32) * 32,
            0,
        );
        assert_eq!(request[..4], resolve::SELECTOR);

        let response = route(
            &mut fork_with_caller(&mock, SHIM),
            "resolve(address,uint256,bytes)",
            &request[4..],
        );
        assert_eq!(
            resolve::decode_response(&response),
            Some(resolve::Resolved {
                kind: resolve::DELEGATE,
                target: IMPL_1,
                strip: 0,
                payload: &[],
            })
        );
    }

    #[test]
    fn encoded_resolution_is_the_response_layout_the_shim_decodes() {
        let payload = vec![0xEE; 40];
        let encoded = encode(&Resolution::answer(payload.clone()));

        let mut expected = vec![0u8; resolve::RESPONSE_HEAD_LEN];
        expected[31] = 0x20;
        expected[63] = resolve::RETURN;
        expected[159] = 0x80;
        expected[191] = payload.len() as u8;
        expected.extend_from_slice(&payload);
        expected.resize(resolve::RESPONSE_HEAD_LEN + 64, 0);
        assert_eq!(encoded, expected);

        let encoded = encode(&Resolution::delegate(Address(IMPL_2), 20));
        assert_eq!(
            resolve::decode_response(&encoded),
            Some(resolve::Resolved {
                kind: resolve::DELEGATE,
                target: IMPL_2,
                strip: 20,
                payload: &[],
            })
        );
    }

    #[test]
    fn every_abi_selector_dispatches() {
        let (mut resolver, _mock) = deployed(&[]);
        let cases: Vec<(&str, Vec<u8>)> = vec![
            (
                "publish(address,uint128,address)",
                encode(&(Address(SHIM), V1_0_0, Address(IMPL_1))),
            ),
            (
                "setMinSupported(address,uint128)",
                encode(&(Address(SHIM), V1_0_0)),
            ),
            ("setFrozen(address,bool)", encode(&(Address(SHIM), false))),
            ("setCode(address)", encode(&Address(IMPL_2))),
            ("getCode()", vec![]),
            ("getAdmin()", vec![]),
            ("routingOf(address)", encode(&Address(SHIM))),
            ("implOf(address,uint128)", encode(&(Address(SHIM), V1_0_0))),
        ];
        for (signature, input) in cases {
            route(&mut resolver, signature, &input);
        }
        let mut buf = [0u8; OUT_LEN];
        let mut out: &mut [u8] = &mut buf;
        assert_eq!(
            contract_resolver::route(&mut resolver, [0xDE, 0xAD, 0xBE, 0xEF], &[], &mut out),
            Outcome::Unhandled
        );
    }

    #[test]
    fn error_selectors_derive_from_signatures() {
        fn sel(signature: &str) -> [u8; 4] {
            let hash = pvm_contract_sdk::keccak256(signature.as_bytes());
            [hash[0], hash[1], hash[2], hash[3]]
        }
        assert_eq!(UnknownVersion::SELECTOR, sel("UnknownVersion()"));
        assert_eq!(
            UnsupportedVersion::SELECTOR,
            sel("UnsupportedVersion(uint128,uint128)")
        );
    }
}
