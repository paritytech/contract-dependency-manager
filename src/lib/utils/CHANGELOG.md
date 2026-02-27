# @dotdm/utils

## 0.2.0

### Minor Changes

- ad38eee: Add account management for deploying on real chains

  - New `@dotdm/utils/accounts` subpath: keypair generation, mnemonic import, `~/.cdm/accounts.json` persistence
  - `cdm init -n <chain>`: auto-generate keypair for testnets, show balances and faucet links
  - `cdm account set/bal/map`: import mnemonic, check Asset Hub balance + Bulletin allowances, map account for Revive pallet
  - Deploy signer resolution: `--suri` >> `accounts.json` >> Alice fallback
  - `prepareSignerFromMnemonic` + full mnemonic support in `prepareSignerFromSuri`
  - Faucet URLs on `ChainPreset` (paseo Asset Hub + Bulletin)

## 0.1.2

### Patch Changes

- 996baee: Move papi descriptors into publishable @dotdm/descriptors package so external npm consumers can resolve chain descriptor imports

## 0.1.1

### Patch Changes

- d0f0c48: fix: release pipeline configuration

## 0.1.0

### Minor Changes

- eee9eb3: Initial public release of @dotdm packages.
