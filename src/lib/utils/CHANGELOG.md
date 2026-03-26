# @dotdm/utils

## 0.3.1

### Patch Changes

- 6e9633a: Fix Node.js ESM compatibility by switching library builds from tsc to tsup. Compiled output now includes proper .js extensions on relative imports, making packages work in both bundler and Node.js ESM environments.

## 0.3.0

### Minor Changes

- 8e1c421: Use CREATE2 for deterministic contract addresses and universal registry

  Deploy all CDM contracts with CREATE2 so every contract gets the same address on every chain. Salt is derived from the CDM package name via blake2b. Establish a universal REGISTRY_ADDRESS constant and remove all per-chain registry configuration.

  **Breaking changes:**

  - Removed `--registry-address` CLI flag from build, deploy, and install commands
  - Removed `registry` field from `CdmJsonTarget` and `cdm.json` schema
  - Removed `registryAddress` from `ChainPreset`
  - `computeTargetHash` no longer accepts a registry address parameter — target hashes will change, requiring `cdm install` to be re-run
  - Removed `CONTRACTS_REGISTRY_ADDR` env var requirement from build command

  **Other changes:**

  - Added `computeDeploySalt` to `@dotdm/contracts`
  - Added `REGISTRY_ADDRESS` constant to `@dotdm/utils` and re-exported from `@dotdm/env` and `@dotdm/contracts`
  - Removed HIDDEN_CONTRACTS patch from frontend (disputes and reputation now visible)
  - Updated template cdm.json files and documentation

## 0.2.7

### Patch Changes

- fee0ba2: Patch bump to trigger CI release pipeline

## 0.2.6

### Patch Changes

- 8102a92: Patch bump to trigger CI release pipeline

## 0.2.5

### Patch Changes

- 7f93a67: Patch version bump for all packages.

## 0.2.4

### Patch Changes

- b4a9361: Patch version bump for all packages.

## 0.2.3

### Patch Changes

- 7507475: Add json-target-spec to .cargo/config.toml for newer nightly Rust compatibility

## 0.2.2

### Patch Changes

- ef832d0: updated template

## 0.2.1

### Patch Changes

- 84038ac: Add error handling to ContractRegistry and fix registry crate name constant

  - Contract: `publish_latest` now reverts with `Unauthorized` / `VersionOverflow` instead of silently returning
  - `registry.ts`: `register()` checks for `ExtrinsicFailed` events after submission
  - Fix `CONTRACTS_REGISTRY_CRATE` constant from `"contracts"` to `"contract-registry"`

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
