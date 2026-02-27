---
"@dotdm/contracts": patch
"@dotdm/utils": patch
---

Add error handling to ContractRegistry and fix registry crate name constant

- Contract: `publish_latest` now reverts with `Unauthorized` / `VersionOverflow` instead of silently returning
- `registry.ts`: `register()` checks for `ExtrinsicFailed` events after submission
- Fix `CONTRACTS_REGISTRY_CRATE` constant from `"contracts"` to `"contract-registry"`
