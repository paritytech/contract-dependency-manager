---
"@parity/cdm-builder": major
"@parity/cdm-env": patch
"@parity/cdm-cli": patch
---

Remove dead API surface. `@parity/cdm-builder` drops never-called exports (`ContractDeployer.deployBatch`, `getOnChainCode`, the flat toposort API `toposort`/`DeploymentOrder`/`createCrateToPackageMap`/`detectDeploymentOrder`, sync `pvmContractBuild`, `computeCid`, `normalizeCdmJson`, the solidity `readSolidityAbi`/`artifactDisplayPath`/`bytecodeSize` helpers), the never-emitted `check-cached` deploy event and `"cached"` summary status, the reserved-but-unused `waitFor`/`timeoutMs`/`gateway` deploy options, the constants re-exports (`GAS_LIMIT`/`STORAGE_DEPOSIT_LIMIT`/`CONTRACTS_REGISTRY_CRATE` — import from `@parity/cdm-utils` instead), the unused `MetadataPublisher` client constructor param, and the hardcoded fake `txHash`/`blockHash` on `publishBatch`/`publish-done`. `@parity/cdm-env` drops the unused `AssetHubConnection`/`BulletinConnection` types. `@parity/cdm-cli` sheds the unwired status-adapter observer API and unreachable UI states, stops running contract detection twice per build/deploy, and now shows where installed artifacts were saved after `cdm install`.
