//! The versioned-call wire format shared by the resolver, the registry
//! implementation, and (via mirrored constants) the TypeScript tooling, plus
//! the protocol between a per-name shim and the resolver.
//!
//! The resolver splits a shim's raw calldata into three subspaces:
//!
//! - **plain**: anything not starting with [`MAGIC`] — delegated to the
//!   latest implementation untouched, so a name reserves zero selectors in
//!   its own ABI space;
//! - **versioned**: `[MAGIC][16-byte version key BE][inner calldata]` —
//!   delegated to that exact version's implementation;
//! - **meta**: `[MAGIC][key = 0][4-byte meta selector][ABI args]` — the CDM
//!   control plane: queries, plus the registry-only `callCode`. Key 0 is
//!   `0.0.0`, which is therefore unpublishable.
//!
//! A version key packs a semver triple as `major << 64 | minor << 32 | patch`
//! (each a `u32`), so integer order equals semver order and a name's
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

/// Classify raw calldata.
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

/// `keccak256(signature)[..4]`.
const fn selector(signature: &[u8]) -> [u8; 4] {
    let hash = keccak_const::Keccak256::new().update(signature).finalize();
    [hash[0], hash[1], hash[2], hash[3]]
}

/// `initialize(uint128,address)` = `0x3a67c2f8`, the entry point `callCode`
/// delivers to every initialization contract.
pub const INITIALIZE_SELECTOR: [u8; 4] = selector(b"initialize(uint128,address)");

/// Meta-call selectors: queries, plus `callCode`, which the resolver only
/// honors when the shim's caller is the registry.
pub mod meta {
    use super::selector;

    /// `callCode(address,bytes)` = `0xd74c1f04`: `[target word][raw calldata]`
    /// delegate-called by the shim against its own storage; live while frozen.
    pub const CALL_CODE: [u8; 4] = selector(b"callCode(address,bytes)");
    /// `frozen()` = `0x054f7d9c`.
    pub const FROZEN: [u8; 4] = selector(b"frozen()");
    /// `implOf(uint128)` = `0xdf379e50`.
    pub const IMPL_OF: [u8; 4] = selector(b"implOf(uint128)");
    /// `latest()` = `0x52bfe789`.
    pub const LATEST: [u8; 4] = selector(b"latest()");
    /// `minSupported()` = `0x900fc468`.
    pub const MIN_SUPPORTED: [u8; 4] = selector(b"minSupported()");
    /// `admin()` = `0xf851a440`.
    pub const ADMIN: [u8; 4] = selector(b"admin()");
}

/// The shim ↔ resolver protocol. A shim forwards every call it receives as
/// one read-only `resolve` request and acts on the `Resolution` it gets back;
/// the shim blob is frozen, so this layout is permanent.
pub mod resolve {
    use super::selector;

    /// `resolve(address caller, uint256 value, bytes data)` = `0x6a418533`.
    pub const SELECTOR: [u8; 4] = selector(b"resolve(address,uint256,bytes)");

    /// Request: `[SELECTOR][caller word][value word][offset 0x60][length
    /// word]` followed by the shim's raw calldata zero-padded to 32 bytes.
    pub const REQUEST_HEADER_LEN: usize = 4 + 4 * 32;

    /// `Resolution.kind`: the shim returns `payload`.
    pub const RETURN: u8 = 0;
    /// `Resolution.kind`: the shim delegate-calls `target` with
    /// `payload ++ data[strip..]`.
    pub const DELEGATE: u8 = 1;

    /// Response: the ABI encoding of `Resolution { uint8 kind, address
    /// target, uint32 strip, bytes payload }` — `[offset 0x20][kind word]
    /// [target word][strip word][offset 0x80][length word]` followed by the
    /// payload zero-padded to 32 bytes.
    pub const RESPONSE_HEAD_LEN: usize = 6 * 32;

    /// The request header for `data_len` bytes of calldata; `value` is the
    /// big-endian `uint256` word.
    pub fn request_header(
        caller: &[u8; 20],
        value: &[u8; 32],
        data_len: usize,
    ) -> [u8; REQUEST_HEADER_LEN] {
        let mut header = [0u8; REQUEST_HEADER_LEN];
        header[..4].copy_from_slice(&SELECTOR);
        header[16..36].copy_from_slice(caller);
        header[36..68].copy_from_slice(value);
        header[99] = 0x60;
        header[124..132].copy_from_slice(&(data_len as u64).to_be_bytes());
        header
    }

    /// A decoded response.
    #[derive(Debug, PartialEq, Eq)]
    pub struct Resolved<'a> {
        pub kind: u8,
        pub target: [u8; 20],
        pub strip: usize,
        pub payload: &'a [u8],
    }

    /// Decode a response; `None` for anything but the exact layout above.
    pub fn decode_response(response: &[u8]) -> Option<Resolved<'_>> {
        if response.len() < RESPONSE_HEAD_LEN
            || !word_is(&response[..32], 0x20)
            || !zeroed(&response[32..63])
            || !zeroed(&response[64..76])
            || !zeroed(&response[96..124])
            || !word_is(&response[128..160], 0x80)
            || !zeroed(&response[160..188])
        {
            return None;
        }
        let mut target = [0u8; 20];
        target.copy_from_slice(&response[76..96]);
        let strip =
            u32::from_be_bytes([response[124], response[125], response[126], response[127]]);
        let len = u32::from_be_bytes([response[188], response[189], response[190], response[191]]);
        let payload = response.get(RESPONSE_HEAD_LEN..RESPONSE_HEAD_LEN + len as usize)?;
        Some(Resolved {
            kind: response[63],
            target,
            strip: strip as usize,
            payload,
        })
    }

    fn zeroed(bytes: &[u8]) -> bool {
        bytes.iter().all(|b| *b == 0)
    }

    fn word_is(word: &[u8], value: u8) -> bool {
        zeroed(&word[..31]) && word[31] == value
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hex4(bytes: [u8; 4]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn magic_is_pinned() {
        // Mirrored in src/lib/contracts/src/proxy.ts; changing it strands
        // every name.
        assert_eq!(hex4(MAGIC), "a2264d53");
    }

    #[test]
    fn initialize_selector_is_pinned() {
        assert_eq!(hex4(INITIALIZE_SELECTOR), "3a67c2f8");
    }

    #[test]
    fn meta_selectors_are_pinned() {
        assert_eq!(hex4(meta::CALL_CODE), "d74c1f04");
        assert_eq!(hex4(meta::FROZEN), "054f7d9c");
        assert_eq!(hex4(meta::IMPL_OF), "df379e50");
        assert_eq!(hex4(meta::LATEST), "52bfe789");
        assert_eq!(hex4(meta::MIN_SUPPORTED), "900fc468");
        assert_eq!(hex4(meta::ADMIN), "f851a440");
    }

    #[test]
    fn resolve_selector_is_pinned() {
        assert_eq!(hex4(resolve::SELECTOR), "6a418533");
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

    // ─── Shim ↔ resolver protocol ────────────────────────────────────────

    #[test]
    fn request_header_is_the_abi_head_of_resolve() {
        let mut value = [0u8; 32];
        value[31] = 7;
        let header = resolve::request_header(&[0xCA; 20], &value, 70);

        let mut expected = vec![0x6a, 0x41, 0x85, 0x33];
        expected.extend_from_slice(&[0u8; 12]);
        expected.extend_from_slice(&[0xCA; 20]);
        expected.extend_from_slice(&value);
        expected.extend_from_slice(&[0u8; 31]);
        expected.push(0x60);
        expected.extend_from_slice(&[0u8; 31]);
        expected.push(70);
        assert_eq!(header.to_vec(), expected);
    }

    /// The canonical response bytes for a `Resolution`.
    fn response(kind: u8, target: [u8; 20], strip: u32, payload: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; resolve::RESPONSE_HEAD_LEN];
        out[31] = 0x20;
        out[63] = kind;
        out[76..96].copy_from_slice(&target);
        out[124..128].copy_from_slice(&strip.to_be_bytes());
        out[159] = 0x80;
        out[188..192].copy_from_slice(&(payload.len() as u32).to_be_bytes());
        out.extend_from_slice(payload);
        out.resize(
            resolve::RESPONSE_HEAD_LEN + payload.len().div_ceil(32) * 32,
            0,
        );
        out
    }

    #[test]
    fn decodes_canonical_responses() {
        let payload = [0xEE; 40];
        assert_eq!(
            resolve::decode_response(&response(resolve::DELEGATE, [0x11; 20], 20, &payload)),
            Some(resolve::Resolved {
                kind: resolve::DELEGATE,
                target: [0x11; 20],
                strip: 20,
                payload: &payload,
            })
        );
        // An empty payload is the common delegate answer.
        assert_eq!(
            resolve::decode_response(&response(resolve::RETURN, [0u8; 20], 0, &[])),
            Some(resolve::Resolved {
                kind: resolve::RETURN,
                target: [0u8; 20],
                strip: 0,
                payload: &[],
            })
        );
    }

    #[test]
    fn rejects_anything_but_the_canonical_layout() {
        let good = response(resolve::DELEGATE, [0x11; 20], 0, &[0xAA; 3]);
        assert!(resolve::decode_response(&good).is_some());

        assert!(resolve::decode_response(&good[..resolve::RESPONSE_HEAD_LEN - 1]).is_none());
        assert!(resolve::decode_response(&[]).is_none());

        // Wrong struct offset, wrong payload offset, dirty high bytes in the
        // kind / target / strip / length words, and a length past the end.
        for (index, byte) in [
            (31, 0x40),
            (159, 0xA0),
            (40, 1),
            (70, 1),
            (100, 1),
            (170, 1),
            (191, 33),
        ] {
            let mut bad = good.clone();
            bad[index] = byte;
            assert!(resolve::decode_response(&bad).is_none(), "byte {index}");
        }
    }
}
