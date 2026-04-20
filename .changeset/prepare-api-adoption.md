---
"@dotdm/contracts": major
---

Adopt the new `@polkadot-apps/contracts` `.prepare()` API (v0.4.0) for building batchable ink calls, drop the direct `@polkadot-api/sdk-ink` dependency, and remove the `RegistryManager` wrapper.

- Bump `@polkadot-apps/contracts` catalog to `^0.4.0`.
- `ContractDeployer.deployAndRegisterBatch(...)` now accepts a `Contract<ContractDef>` (from `@polkadot-apps/contracts`) and uses `contract.publishLatest.prepare(...)` to build `BatchableCall`s for `batchSubmitAndWatch`, removing the previous `@polkadot-api/sdk-ink` `registry.send(...)` drop-down.
- `RegistryManager` and its related exports (`getRegistryContract`, `RegistryContract`) have been removed from `@dotdm/contracts`. The class was a thin wrapper whose only consumer was the internal pipeline; the registry `Contract` is now constructed inline in `deployContracts()` via `createContractFromClient`.
- Removes `@polkadot-api/sdk-ink` from `@dotdm/contracts`'s direct dependencies (still pulled transitively by `@polkadot-apps/contracts`' `createContractFromClient`).
