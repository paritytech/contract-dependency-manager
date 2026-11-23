//! Reading Solidity-ABI calldata by hand.

use crate::Host;

/// Every method call starts with a selector, and its arguments follow.
pub const SELECTOR_LEN: usize = 4;

pub const fn keccak(input: &[u8]) -> [u8; 32] {
    keccak_const::Keccak256::new().update(input).finalize()
}

/// `keccak256(signature)[..4]`.
pub const fn selector(signature: &[u8]) -> [u8; 4] {
    let hash = keccak(signature);
    [hash[0], hash[1], hash[2], hash[3]]
}

/// Find a `bytes` argument through its offset word `head`: where its data
/// starts in the calldata of `size` bytes, and how long it is. `None` when
/// its length word or its data would end past the calldata.
pub fn bytes_argument<H: Host>(host: &H, size: usize, head: &[u8]) -> Option<(usize, usize)> {
    let length_at = SELECTOR_LEN.checked_add(low_bytes(head))?;
    let start = length_at.checked_add(32)?;
    if start > size {
        return None;
    }
    let mut length = [0u8; 32];
    host.call_data_copy(&mut length, length_at);
    let end = start.checked_add(low_bytes(&length))?;
    (end <= size).then_some((start, end - start))
}

/// The low 8 bytes of an ABI word, as offset and length words are read.
pub fn low_bytes(word: &[u8]) -> usize {
    let mut low = [0u8; 8];
    low.copy_from_slice(&word[24..32]);
    u64::from_be_bytes(low) as usize
}
