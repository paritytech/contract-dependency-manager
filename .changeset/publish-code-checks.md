---
"@parity/cdm-builder": patch
---

The registry's `publish` and `publishWithInit` revert when the implementation (`BadImplementation`) or the initialization target (`InvalidInitTarget`) has no code on-chain.
