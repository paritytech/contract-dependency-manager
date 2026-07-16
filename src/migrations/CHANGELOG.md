# @parity/cdm-migrations

## 0.0.4

### Patch Changes

- ad53253: Add a `devnet` chain preset for the Paseo testnet Asset Hub (EVM chain id 420420417) wired to the community-operated ContractRegistry at `0x59b0245778917af55224e5f8fb55f7f8d452619f`, using the dedicated devnet descriptors and Bulletin RPC introduced in product-sdk 0.18.0, and clarify that the `paseo` preset targets the paseo-next preview network. Upgrades all `@parity/product-sdk-*` dependencies to the 0.18.0 release set and migrates to its `Result`-based error API (`submitAndWatch`, `batchSubmitAndWatch`, contract `.tx`/`.prepare`, `ensureContractAccountMapped`, cloud-storage `queryJson`).
- Updated dependencies [ad53253]
  - @parity/cdm-env@2.1.0
  - @parity/cdm-builder@3.2.0

## 0.0.3

### Patch Changes

- Updated dependencies [79fbc58]
  - @parity/cdm-env@2.0.8
  - @parity/cdm-builder@3.1.9

## 0.0.2

### Patch Changes

- Updated dependencies [40f6516]
  - @parity/cdm-env@2.0.7
  - @parity/cdm-builder@3.1.8
