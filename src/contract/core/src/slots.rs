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
        assert_ne!(IMPLEMENTATION_SLOT, ADMIN_SLOT);
        assert_ne!(IMPLEMENTATION_SLOT, FROZEN_SLOT);
        assert_ne!(ADMIN_SLOT, FROZEN_SLOT);
    }
}
