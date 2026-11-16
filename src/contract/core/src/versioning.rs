//! The versioned-call wire format shared by the per-name shim, the resolver,
//! the registry implementation, and (via mirrored constants) the TypeScript
//! tooling, plus the shim's own state and the protocol between a shim and
//! the resolver.
//!
//! A shim's raw calldata splits into three subspaces:
//!
//! - **plain**: anything not starting with [`MAGIC`] — delegated to the
//!   latest implementation untouched, so a name reserves zero selectors in
//!   its own ABI space;
//! - **versioned**: `[MAGIC][16-byte version key BE][inner calldata]` — the
//!   inner calldata is delegated to that exact version's implementation;
//! - **meta**: `[MAGIC][key = 0][4-byte meta selector][ABI args]` — the CDM
//!   control plane. The shim answers the selectors in [`shim`] itself; every
//!   other one goes to the resolver, which serves the queries in [`meta`]
//!   plus the registry-only `callCode`. Key 0 is `0.0.0`, which is therefore
//!   unpublishable.
//!
//! A shim that holds the latest version in [`shim::FAST_SLOT`] serves plain
//! calls and versioned calls for that key from it. Every other call it does
//! not answer itself goes to the resolver as a [`resolve`] request — or, once
//! the shim is sealed, reverts.
//!
//! A version key packs a semver triple as `major << 64 | minor << 32 | patch`
//! (minor and patch each a `u32`, major at most [`MAX_MAJOR`]), so integer
//! order equals semver order and a name's append-only version list is sorted
//! by construction.

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

/// The largest major version a name can publish. The shim keeps a version
/// key in 95 bits of its state word, one fewer than three `u32`s.
pub const MAX_MAJOR: u32 = u32::MAX >> 1;

/// A publishable key: non-zero (0.0.0 is the meta namespace) with the top 33
/// bits clear (a packed triple whose major is at most [`MAX_MAJOR`]).
pub const fn is_publishable_key(key: u128) -> bool {
    key != META_KEY && (key >> 95) == 0
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

/// Meta-call selectors the resolver serves: queries, plus `callCode`, which
/// it only honors when the shim's caller is the registry.
pub mod meta {
    use super::selector;

    /// `callCode(address,bytes)` = `0xd74c1f04`: `[target word][raw calldata]`
    /// delegate-called by the shim against its own storage; live while frozen.
    pub const CALL_CODE: [u8; 4] = selector(b"callCode(address,bytes)");
    /// `frozen()` = `0x054f7d9c`.
    pub const FROZEN: [u8; 4] = selector(b"frozen()");
    /// `implOf(uint128)` = `0xdf379e50`.
    pub const IMPL_OF: [u8; 4] = selector(b"implOf(uint128)");
    /// `latest()` = `0x52bfe789`: `(uint128 key, address implementation)`. A
    /// shim that holds the latest version answers it from its own
    /// [`shim::FAST_SLOT`](super::shim::FAST_SLOT) without asking.
    pub const LATEST: [u8; 4] = selector(b"latest()");
    /// `minSupported()` = `0x900fc468`.
    pub const MIN_SUPPORTED: [u8; 4] = selector(b"minSupported()");
    /// `admin()` = `0xf851a440`.
    pub const ADMIN: [u8; 4] = selector(b"admin()");
}

/// The shim's own state and the meta calls it answers without the resolver.
/// The shim blob is frozen, so the slot, the word layout, and the selectors
/// are permanent.
pub mod shim {
    use super::selector;
    use crate::slots::eip1967_slot;

    /// All of the shim's own state, as one [`pack_fast_path`] word: the
    /// version it serves without asking the resolver, and whether it is
    /// sealed. All zero when it has no shortcut. An EIP-1967-style slot, so
    /// an implementation's ordinary storage never lands on it.
    /// `0xf0a018d1f0a0c89702867d3b938e95b2525db0fc04b1c93fdac5127d62eef3a2`
    pub const FAST_SLOT: [u8; 32] = eip1967_slot(b"cdm.shim.fast");

    /// Set in the first byte of the [`FAST_SLOT`] word once the shim is
    /// sealed.
    pub const SEALED_FLAG: u8 = 0x80;

    /// `sealed()` = `0xe4b203ef`: `bool`.
    pub const SEALED: [u8; 4] = selector(b"sealed()");
    /// `resolver()` = `0x04f3bcec`: the shim's immutable resolver `address`.
    pub const RESOLVER: [u8; 4] = selector(b"resolver()");
    /// `setFastPath(uint128,address)` = `0x8682471f`: resolver-only; stores
    /// `(key, implementation)` in [`FAST_SLOT`], or clears it when
    /// `implementation` is zero.
    pub const SET_FAST_PATH: [u8; 4] = selector(b"setFastPath(uint128,address)");
    /// `seal(uint128,address)` = `0xe2e33028`: resolver-only; stores
    /// `(key, implementation)` in [`FAST_SLOT`] with [`SEALED_FLAG`] set.
    pub const SEAL: [u8; 4] = selector(b"seal(uint128,address)");

    /// The [`FAST_SLOT`] word: `[sealed: 1 bit][version key: 95 bits
    /// big-endian][implementation: 20 bytes]`. `key` must be publishable:
    /// its top 33 bits are clear, so the 95 bits hold all of it.
    #[inline]
    pub fn pack_fast_path(key: u128, implementation: &[u8; 20], sealed: bool) -> [u8; 32] {
        let mut word = [0u8; 32];
        // Major and minor, then patch.
        word[..8].copy_from_slice(&((key >> 32) as u64).to_be_bytes());
        word[8..12].copy_from_slice(&(key as u32).to_be_bytes());
        word[12..].copy_from_slice(implementation);
        if sealed {
            word[0] |= SEALED_FLAG;
        }
        word
    }

    /// Split a [`FAST_SLOT`] word into `(sealed, version key, implementation)`.
    #[inline]
    pub fn unpack_fast_path(word: &[u8; 32]) -> (bool, u128, [u8; 20]) {
        let mut high = [0u8; 8];
        high.copy_from_slice(&word[..8]);
        let sealed = high[0] & SEALED_FLAG != 0;
        high[0] &= !SEALED_FLAG;
        let mut low = [0u8; 4];
        low.copy_from_slice(&word[8..12]);
        let key = ((u64::from_be_bytes(high) as u128) << 32) | u32::from_be_bytes(low) as u128;
        let mut implementation = [0u8; 20];
        implementation.copy_from_slice(&word[12..]);
        (sealed, key, implementation)
    }
}

/// The shim ↔ resolver protocol. A shim forwards every call it does not
/// serve itself as one read-only `resolve` request and acts on the
/// `Resolution` it gets back; the shim blob is frozen, so this layout is
/// permanent.
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

    fn hex32(bytes: [u8; 32]) -> String {
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
    fn shim_slot_is_pinned() {
        // Every shim ever created keeps its state at this slot.
        assert_eq!(
            hex32(shim::FAST_SLOT),
            "f0a018d1f0a0c89702867d3b938e95b2525db0fc04b1c93fdac5127d62eef3a2"
        );
    }

    #[test]
    fn shim_selectors_are_pinned() {
        assert_eq!(hex4(shim::SEALED), "e4b203ef");
        assert_eq!(hex4(shim::RESOLVER), "04f3bcec");
        assert_eq!(hex4(shim::SET_FAST_PATH), "8682471f");
        assert_eq!(hex4(shim::SEAL), "e2e33028");
    }

    #[test]
    fn fast_path_word_is_the_key_then_the_implementation() {
        let key = pack_version(1, 2, 3);
        let word = shim::pack_fast_path(key, &[0xAB; 20], false);

        // Major, minor, patch as big-endian u32s, then the address.
        let mut expected = vec![0, 0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 3];
        expected.extend_from_slice(&[0xAB; 20]);
        assert_eq!(word.to_vec(), expected);
        assert_eq!(shim::unpack_fast_path(&word), (false, key, [0xAB; 20]));
    }

    #[test]
    fn sealing_sets_only_the_top_bit_of_the_fast_path_word() {
        let key = pack_version(1, 2, 3);
        let mut expected = shim::pack_fast_path(key, &[0xAB; 20], false);
        expected[0] = 0x80;
        let sealed = shim::pack_fast_path(key, &[0xAB; 20], true);
        assert_eq!(sealed, expected);
        assert_eq!(shim::unpack_fast_path(&sealed), (true, key, [0xAB; 20]));

        // The largest publishable key leaves the flag's bit free.
        let max = pack_version(MAX_MAJOR, u32::MAX, u32::MAX);
        for flag in [false, true] {
            assert_eq!(
                shim::unpack_fast_path(&shim::pack_fast_path(max, &[0x01; 20], flag)),
                (flag, max, [0x01; 20])
            );
        }
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
            MAX_MAJOR,
            u32::MAX,
            u32::MAX
        )));
        // The next major would land on the shim's sealed flag.
        assert!(!is_publishable_key(pack_version(MAX_MAJOR + 1, 0, 0)));
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
