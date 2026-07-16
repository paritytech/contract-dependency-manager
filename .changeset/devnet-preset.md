---
"@parity/cdm-env": minor
"@parity/cdm-cli": minor
"@parity/cdm-builder": minor
"@parity/cdm-codegen": patch
"@parity/cdm-migrations": patch
---

Add a `devnet` chain preset for the Paseo testnet Asset Hub (EVM chain id 420420417) wired to the community-operated ContractRegistry at `0x59b0245778917af55224e5f8fb55f7f8d452619f`, using the dedicated devnet descriptors and Bulletin RPC introduced in product-sdk 0.18.0, and clarify that the `paseo` preset targets the paseo-next preview network. Upgrades all `@parity/product-sdk-*` dependencies to the 0.18.0 release set and migrates to its `Result`-based error API (`submitAndWatch`, `batchSubmitAndWatch`, contract `.tx`/`.prepare`, `ensureContractAccountMapped`, cloud-storage `queryJson`).
