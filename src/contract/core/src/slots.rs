//! Fixed storage slots shared by the registry implementation and its proxy.
//!
//! Upgrade/admin state lives at pseudo-random slots outside the sequential
//! slot range (the EIP-1967 scheme), so a future implementation can reshape
//! its ordinary storage fields freely without ever colliding with — or
//! having to re-declare — the slots the proxy relies on.

/// `keccak256(label) - 1`, the EIP-1967 slot derivation. The `- 1` guarantees
/// no known keccak preimage maps to the slot.
const fn eip1967_slot(label: &[u8]) -> [u8; 32] {
    minus_one(keccak_const::Keccak256::new().update(label).finalize())
}

/// Big-endian 256-bit decrement.
const fn minus_one(mut bytes: [u8; 32]) -> [u8; 32] {
    let mut i = 31;
    loop {
        let (b, borrow) = bytes[i].overflowing_sub(1);
        bytes[i] = b;
        if !borrow || i == 0 {
            break;
        }
        i -= 1;
    }
    bytes
}

/// Address of the implementation the proxy delegates to.
/// `0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc`
pub const IMPLEMENTATION_SLOT: [u8; 32] = eip1967_slot(b"eip1967.proxy.implementation");

/// Address allowed to upgrade, freeze, and import registry state.
/// `0xb53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103`
pub const ADMIN_SLOT: [u8; 32] = eip1967_slot(b"eip1967.proxy.admin");

/// Non-zero while the registry is frozen (reads only, admin exempt).
pub const FROZEN_SLOT: [u8; 32] = eip1967_slot(b"cdm.registry.frozen");

/// Per-name proxy: floor version key below which versioned calls revert
/// `UnsupportedVersion`. Zero means no floor.
/// `0xfd72a9137a39672ad1c11d82c8f2377dc3795fa498e00ec272c1d6c9fedb4974`
pub const MIN_SUPPORTED_SLOT: [u8; 32] = eip1967_slot(b"cdm.proxy.min_supported");

/// Per-name proxy: the latest published version key, for the monotonic
/// publish check and the `latest()` meta query. Zero before first publish.
/// `0x7d2e53e7260319608bac9e6f155af7a188ade8cda24ee2259128ceb1248eceb0`
pub const LATEST_KEY_SLOT: [u8; 32] = eip1967_slot(b"cdm.proxy.latest_key");

/// Per-name proxy: root of the `Mapping<u128, Address>` from version key to
/// implementation.
/// `0x95017cb99a656583260fc72407f66dd08850fc86ea2c1cd064a6c3c51785b8ee`
pub const IMPL_OF_SLOT: [u8; 32] = eip1967_slot(b"cdm.proxy.impl_of");

#[cfg(test)]
mod tests {
    use super::*;

    fn hex(bytes: [u8; 32]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn implementation_slot_matches_eip1967() {
        assert_eq!(
            hex(IMPLEMENTATION_SLOT),
            "360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc"
        );
    }

    #[test]
    fn admin_slot_matches_eip1967() {
        assert_eq!(
            hex(ADMIN_SLOT),
            "b53127684a568b3173ae13b9f8a6016e243e63b6e8ee1178d6a717850b5d6103"
        );
    }

    #[test]
    fn slots_are_distinct() {
        let all = [
            IMPLEMENTATION_SLOT,
            ADMIN_SLOT,
            FROZEN_SLOT,
            MIN_SUPPORTED_SLOT,
            LATEST_KEY_SLOT,
            IMPL_OF_SLOT,
        ];
        for (i, a) in all.iter().enumerate() {
            for b in &all[i + 1..] {
                assert_ne!(a, b);
            }
        }
    }

    #[test]
    fn proxy_slots_are_pinned() {
        // Mirrored in TS tooling; a drift here silently re-homes proxy state.
        assert_eq!(
            hex(MIN_SUPPORTED_SLOT),
            "fd72a9137a39672ad1c11d82c8f2377dc3795fa498e00ec272c1d6c9fedb4974"
        );
        assert_eq!(
            hex(LATEST_KEY_SLOT),
            "7d2e53e7260319608bac9e6f155af7a188ade8cda24ee2259128ceb1248eceb0"
        );
        assert_eq!(
            hex(IMPL_OF_SLOT),
            "95017cb99a656583260fc72407f66dd08850fc86ea2c1cd064a6c3c51785b8ee"
        );
    }
}
