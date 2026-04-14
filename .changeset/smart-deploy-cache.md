---
"@dotdm/contracts": minor
"@dotdm/cli": minor
"@dotdm/descriptors": patch
---

feat: smart deploy caching — skip unchanged contracts

Contracts that are already deployed on-chain with identical bytecode are now skipped during `cdm deploy`. After building, the pipeline compares local `.polkavm` bytecode against on-chain pristine code (via `AccountInfoOf` + `PristineCode` storage). Matching bytecode shows as cached (`~`) in the deploy table. This is signer-independent — cache hits work regardless of which account originally deployed.

Also fixes the `@dotdm/descriptors` package failing in CI by removing the unused `file:generated` dependency.
