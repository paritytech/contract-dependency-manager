---
"@parity/cdm-env": patch
---

Point the `devnet` IPFS gateway at the Bulletin-peered Kubo node

The `devnet` preset resolved metadata through `https://ipfs.io/ipfs`. Content
stored on Bulletin Paseo is not reachable that way — the collator speaks Bitswap
only and does not announce to the public IPFS DHT — so `cdm install -n devnet`
timed out fetching contract metadata by CID.

Use the Kubo gateway peered to the devnet Bulletin node instead.
