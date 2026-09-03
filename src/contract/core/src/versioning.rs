//! The versioned-call wire format shared by the per-name proxy, the registry
//! implementation, and (via mirrored constants) the TypeScript tooling.
//!
//! A per-name proxy splits raw calldata into three subspaces:
//!
//! - **plain**: anything not starting with [`MAGIC`] — delegated to the
//!   latest implementation untouched, so the proxy reserves zero selectors
//!   in the contract's own ABI space;
//! - **versioned**: `[MAGIC][16-byte version key BE][inner calldata]` —
//!   delegated to that exact version's implementation;
//! - **meta**: `[MAGIC][key = 0][4-byte meta selector][ABI args]` — the CDM
//!   control plane (queries + registry-only admin operations). Key 0 is
//!   `0.0.0`, which is therefore unpublishable.
//!
//! A version key packs a semver triple as `major << 64 | minor << 32 | patch`
//! (each a `u32`), so integer order equals semver order and the proxy's
//! append-only version list is sorted by construction.

/// First 4 calldata bytes marking a CDM versioned or meta call.
/// `keccak256("cdm.proxy.call.v1")[..4]` = `0xa2264d53`.
pub const MAGIC: [u8; 4] = {
    let hash = keccak_const::Keccak256::new()
        .update(b"cdm.proxy.call.v1")
        .finalize();
    [hash[0], hash[1], hash[2], hash[3]]
};

/// Version key reserved for meta calls; `0.0.0` can never be published.
pub const META_KEY: u128 = 0;

/// `[MAGIC][u128 key]` — the shortest well-formed versioned call.
pub const VERSIONED_HEADER_LEN: usize = 4 + 16;

/// `[MAGIC][META_KEY][meta selector]` — the shortest well-formed meta call.
pub const META_HEADER_LEN: usize = VERSIONED_HEADER_LEN + 4;

/// Pack a semver triple into its ordered u128 key.
pub const fn pack_version(major: u32, minor: u32, patch: u32) -> u128 {
    ((major as u128) << 64) | ((minor as u128) << 32) | (patch as u128)
}

/// Split a key back into `(major, minor, patch)`.
pub const fn unpack_version(key: u128) -> (u32, u32, u32) {
    ((key >> 64) as u32, (key >> 32) as u32, key as u32)
}

/// A publishable key: non-zero (0.0.0 is the meta namespace) with the top 32
/// bits clear (the packed form of any real triple).
pub const fn is_publishable_key(key: u128) -> bool {
    key != META_KEY && (key >> 96) == 0
}

/// Where a piece of raw calldata routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CallRoute {
    /// No magic prefix — delegate to the latest implementation as-is.
    Plain,
    /// `[MAGIC][key]` — delegate `calldata[VERSIONED_HEADER_LEN..]` to the
    /// implementation published under `key`.
    Versioned(u128),
    /// `[MAGIC][0][selector]` — dispatch the meta operation; its ABI args
    /// start at `META_HEADER_LEN`.
    Meta([u8; 4]),
    /// Starts with the magic prefix but is too short to be either form.
    Malformed,
}

/// Classify raw calldata. Pure, alloc-free; the proxy's fallback delegates
/// routing decisions here so the format is unit-testable off-host.
pub const fn route_calldata(input: &[u8]) -> CallRoute {
    if input.len() < 4
        || input[0] != MAGIC[0]
        || input[1] != MAGIC[1]
        || input[2] != MAGIC[2]
        || input[3] != MAGIC[3]
    {
        return CallRoute::Plain;
    }
    if input.len() < VERSIONED_HEADER_LEN {
        return CallRoute::Malformed;
    }
    let mut key_bytes = [0u8; 16];
    let mut i = 0;
    while i < 16 {
        key_bytes[i] = input[4 + i];
        i += 1;
    }
    let key = u128::from_be_bytes(key_bytes);
    if key != META_KEY {
        return CallRoute::Versioned(key);
    }
    if input.len() < META_HEADER_LEN {
        return CallRoute::Malformed;
    }
    CallRoute::Meta([input[20], input[21], input[22], input[23]])
}

/// `keccak256(signature)[..4]`, the meta-selector derivation.
const fn meta_selector(signature: &[u8]) -> [u8; 4] {
    let hash = keccak_const::Keccak256::new().update(signature).finalize();
    [hash[0], hash[1], hash[2], hash[3]]
}

/// `initialize(uint128,address)` = `0x3a67c2f8` — the entry point the registry
/// calls on every initialization contract via `callCode`; byte-locked across
/// the registry, the TS tooling, and every initialization ever compiled.
pub const INITIALIZE_SELECTOR: [u8; 4] = meta_selector(b"initialize(uint128,address)");

/// Meta-call selectors. Queries are open; `publish`, `setMinSupported`,
/// `setAdmin`, and `callCode` require the caller to be the proxy's admin
/// (the registry).
pub mod meta {
    use super::meta_selector;

    /// `publish(uint128,address)` = `0xc3853395` (admin).
    pub const PUBLISH: [u8; 4] = meta_selector(b"publish(uint128,address)");
    /// `callCode(address,bytes)` = `0xd74c1f04` (admin) — delegate-call against
    /// the proxy's storage, bubbling return/revert verbatim. Live while frozen.
    pub const CALL_CODE: [u8; 4] = meta_selector(b"callCode(address,bytes)");
    /// `setMinSupported(uint128)` = `0xe84411e5` (admin).
    pub const SET_MIN_SUPPORTED: [u8; 4] = meta_selector(b"setMinSupported(uint128)");
    /// `setAdmin(address)` = `0x704b6c02` (admin).
    pub const SET_ADMIN: [u8; 4] = meta_selector(b"setAdmin(address)");
    /// `freeze()` = `0x62a5af3b` (admin).
    pub const FREEZE: [u8; 4] = meta_selector(b"freeze()");
    /// `unfreeze()` = `0x6a28f000` (admin).
    pub const UNFREEZE: [u8; 4] = meta_selector(b"unfreeze()");
    /// `frozen()` = `0x054f7d9c`.
    pub const FROZEN: [u8; 4] = meta_selector(b"frozen()");
    /// `implOf(uint128)` = `0xdf379e50`.
    pub const IMPL_OF: [u8; 4] = meta_selector(b"implOf(uint128)");
    /// `latest()` = `0x52bfe789`.
    pub const LATEST: [u8; 4] = meta_selector(b"latest()");
    /// `minSupported()` = `0x900fc468`.
    pub const MIN_SUPPORTED: [u8; 4] = meta_selector(b"minSupported()");
    /// `admin()` = `0xf851a440`.
    pub const ADMIN: [u8; 4] = meta_selector(b"admin()");
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex4(bytes: [u8; 4]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn magic_is_pinned() {
        // Mirrored in TS (src/lib/contracts/src/proxy.ts) and, once consumer
        // pinning lands, in pvm-cdm-macros. Changing it strands every proxy.
        assert_eq!(hex4(MAGIC), "a2264d53");
    }

    #[test]
    fn initialize_selector_is_pinned() {
        assert_eq!(hex4(INITIALIZE_SELECTOR), "3a67c2f8");
    }

    #[test]
    fn meta_selectors_are_pinned() {
        assert_eq!(hex4(meta::PUBLISH), "c3853395");
        assert_eq!(hex4(meta::CALL_CODE), "d74c1f04");
        assert_eq!(hex4(meta::SET_MIN_SUPPORTED), "e84411e5");
        assert_eq!(hex4(meta::SET_ADMIN), "704b6c02");
        assert_eq!(hex4(meta::FREEZE), "62a5af3b");
        assert_eq!(hex4(meta::UNFREEZE), "6a28f000");
        assert_eq!(hex4(meta::FROZEN), "054f7d9c");
        assert_eq!(hex4(meta::IMPL_OF), "df379e50");
        assert_eq!(hex4(meta::LATEST), "52bfe789");
        assert_eq!(hex4(meta::MIN_SUPPORTED), "900fc468");
        assert_eq!(hex4(meta::ADMIN), "f851a440");
    }

    #[test]
    fn version_key_packs_and_unpacks() {
        let key = pack_version(2, 3, 14);
        assert_eq!(key, (2u128 << 64) | (3u128 << 32) | 14);
        assert_eq!(unpack_version(key), (2, 3, 14));
        assert_eq!(
            unpack_version(pack_version(u32::MAX, u32::MAX, u32::MAX)),
            (u32::MAX, u32::MAX, u32::MAX)
        );
    }

    #[test]
    fn key_order_is_semver_order() {
        let ordered = [
            pack_version(0, 0, 1),
            pack_version(0, 0, 13),
            pack_version(0, 1, 0),
            pack_version(0, 12, 0),
            pack_version(1, 0, 0),
            pack_version(1, 0, 1),
            pack_version(2, 0, 0),
        ];
        assert!(ordered.windows(2).all(|w| w[0] < w[1]));
    }

    #[test]
    fn publishable_key_bounds() {
        assert!(!is_publishable_key(META_KEY));
        assert!(is_publishable_key(pack_version(0, 0, 1)));
        assert!(is_publishable_key(pack_version(
            u32::MAX,
            u32::MAX,
            u32::MAX
        )));
        // Anything with the top 32 bits set is not a packed triple.
        assert!(!is_publishable_key(1u128 << 96));
        assert!(!is_publishable_key(u128::MAX));
    }

    #[test]
    fn routes_plain_calldata() {
        assert_eq!(route_calldata(&[]), CallRoute::Plain);
        assert_eq!(route_calldata(&[0x01]), CallRoute::Plain);
        // A real selector that is not the magic.
        assert_eq!(
            route_calldata(&[0xbf, 0x40, 0xfa, 0xc1, 0xAA]),
            CallRoute::Plain
        );
        // Magic differing in the last byte.
        assert_eq!(route_calldata(&[0xa2, 0x26, 0x4d, 0x54]), CallRoute::Plain);
    }

    #[test]
    fn routes_versioned_calldata() {
        let key = pack_version(1, 2, 3);
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&key.to_be_bytes());
        // Empty inner calldata is legal (delegates a bare call).
        assert_eq!(route_calldata(&data), CallRoute::Versioned(key));
        data.extend_from_slice(&[0xde, 0xad, 0xbe, 0xef, 0x01]);
        assert_eq!(route_calldata(&data), CallRoute::Versioned(key));
    }

    #[test]
    fn routes_meta_calldata() {
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&META_KEY.to_be_bytes());
        data.extend_from_slice(&meta::LATEST);
        assert_eq!(route_calldata(&data), CallRoute::Meta(meta::LATEST));
        // Args after the meta selector don't change the route.
        data.extend_from_slice(&[0u8; 32]);
        assert_eq!(route_calldata(&data), CallRoute::Meta(meta::LATEST));
    }

    #[test]
    fn magic_prefixed_but_truncated_is_malformed() {
        // Magic alone, or magic + partial key.
        assert_eq!(route_calldata(&MAGIC), CallRoute::Malformed);
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&[0u8; 8]);
        assert_eq!(route_calldata(&data), CallRoute::Malformed);
        // Meta key with a truncated selector.
        let mut data = MAGIC.to_vec();
        data.extend_from_slice(&META_KEY.to_be_bytes());
        data.extend_from_slice(&[0xc3, 0x85]);
        assert_eq!(route_calldata(&data), CallRoute::Malformed);
    }
}
