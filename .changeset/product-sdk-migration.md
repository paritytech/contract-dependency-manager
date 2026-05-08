---
"@dotdm/contracts": major
"@dotdm/cdm": minor
"@dotdm/env": patch
"@dotdm/cli": minor
---

Migrate CDM runtime and templates from `@polkadot-apps` packages to the published `@parity/product-sdk` packages.

`@dotdm/contracts` now uses product-sdk contracts for registry contract handles and `.prepare()` calls, product-sdk bulletin for metadata publishing, and product-sdk-compatible CID precomputation.

`@dotdm/cdm` now emits product-sdk contract module augmentations for `.cdm/contracts.d.ts`.

`@dotdm/env` now uses product-sdk descriptors for CDM chain connections.

`@dotdm/cli` now installs and deploys through the product-sdk-backed runtime path.
