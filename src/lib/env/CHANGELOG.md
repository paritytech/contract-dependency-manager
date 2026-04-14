# @dotdm/env

## 0.3.2

### Patch Changes

- Updated dependencies [842d557]
  - @dotdm/descriptors@0.1.9

## 0.3.1

### Patch Changes

- 6e9633a: Fix Node.js ESM compatibility by switching library builds from tsc to tsup. Compiled output now includes proper .js extensions on relative imports, making packages work in both bundler and Node.js ESM environments.
- Updated dependencies [6e9633a]
  - @dotdm/utils@0.3.1

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

### Patch Changes

- Updated dependencies [8e1c421]
  - @dotdm/utils@0.3.0
  - @dotdm/descriptors@0.1.8

## 0.2.8

### Patch Changes

- fee0ba2: Patch bump to trigger CI release pipeline
- Updated dependencies [fee0ba2]
  - @dotdm/utils@0.2.7
  - @dotdm/descriptors@0.1.7

## 0.2.7

### Patch Changes

- 8102a92: Patch bump to trigger CI release pipeline
- Updated dependencies [8102a92]
  - @dotdm/utils@0.2.6
  - @dotdm/descriptors@0.1.6

## 0.2.6

### Patch Changes

- 7f93a67: Patch version bump for all packages.
- Updated dependencies [7f93a67]
  - @dotdm/utils@0.2.5
  - @dotdm/descriptors@0.1.5

## 0.2.5

### Patch Changes

- b4a9361: Patch version bump for all packages.
- Updated dependencies [b4a9361]
  - @dotdm/utils@0.2.4
  - @dotdm/descriptors@0.1.4

## 0.2.4

### Patch Changes

- 214fa72: Update preview-net registry contract address after redeployment

## 0.2.3

### Patch Changes

- 7507475: Add json-target-spec to .cargo/config.toml for newer nightly Rust compatibility
- Updated dependencies [7507475]
  - @dotdm/utils@0.2.3
  - @dotdm/descriptors@0.1.3

## 0.2.2

### Patch Changes

- ef832d0: updated template
- Updated dependencies [ef832d0]
  - @dotdm/utils@0.2.2
  - @dotdm/descriptors@0.1.2

## 0.2.1

### Patch Changes

- Updated dependencies [84038ac]
  - @dotdm/utils@0.2.1

## 0.2.0

### Minor Changes

- ad38eee: Add account management for deploying on real chains

  - New `@dotdm/utils/accounts` subpath: keypair generation, mnemonic import, `~/.cdm/accounts.json` persistence
  - `cdm init -n <chain>`: auto-generate keypair for testnets, show balances and faucet links
  - `cdm account set/bal/map`: import mnemonic, check Asset Hub balance + Bulletin allowances, map account for Revive pallet
  - Deploy signer resolution: `--suri` >> `accounts.json` >> Alice fallback
  - `prepareSignerFromMnemonic` + full mnemonic support in `prepareSignerFromSuri`
  - Faucet URLs on `ChainPreset` (paseo Asset Hub + Bulletin)

### Patch Changes

- Updated dependencies [ad38eee]
  - @dotdm/utils@0.2.0

## 0.1.3

### Patch Changes

- 00add1d: Update preview-net registry address after chain reset.

## 0.1.2

### Patch Changes

- 996baee: Move papi descriptors into publishable @dotdm/descriptors package so external npm consumers can resolve chain descriptor imports
- Updated dependencies [996baee]
  - @dotdm/descriptors@0.1.1
  - @dotdm/utils@0.1.2

## 0.1.1

### Patch Changes

- d0f0c48: fix: release pipeline configuration
- Updated dependencies [d0f0c48]
  - @dotdm/utils@0.1.1

## 0.1.0

### Minor Changes

- eee9eb3: Initial public release of @dotdm packages.

### Patch Changes

- Updated dependencies [eee9eb3]
  - @dotdm/utils@0.1.0
