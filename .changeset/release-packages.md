---
"@dotdm/contracts": patch
"@dotdm/cli": patch
---

Fix deploy dry-run using Alice's address instead of the actual signer

The deployer was hardcoding ALICE_SS58 as the origin for dry-run gas/storage estimation. On public testnets this caused misleading errors (e.g. StorageDepositNotEnoughFunds) when the actual signer's account state differed from Alice's. Dry-runs now use the real signer's SS58 address.
