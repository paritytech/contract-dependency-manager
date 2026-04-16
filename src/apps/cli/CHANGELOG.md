# @dotdm/cli

## 0.5.2

### Patch Changes

- 03c4d9c: generate .cdm/contracts.d.ts for @polkadot-apps/contracts, while keeping .cdm/cdm.d.ts for backward compatibility

## 0.5.1

### Patch Changes

- 217de84: Trigger CI release for CLI binary

## 0.5.0

### Minor Changes

- 842d557: feat: smart deploy caching — skip unchanged contracts

  Contracts that are already deployed on-chain with identical bytecode are now skipped during `cdm deploy`. After building, the pipeline compares local `.polkavm` bytecode against on-chain pristine code (via `AccountInfoOf` + `PristineCode` storage). Matching bytecode shows as cached (`~`) in the deploy table. This is signer-independent — cache hits work regardless of which account originally deployed.

  Also fixes the `@dotdm/descriptors` package failing in CI by removing the unused `file:generated` dependency.

### Patch Changes

- Updated dependencies [842d557]
  - @dotdm/contracts@0.4.0
  - @dotdm/descriptors@0.1.9
  - @dotdm/cdm@0.5.4
  - @dotdm/env@0.3.2

## 0.4.5

### Patch Changes

- 5713d52: Fix template CLAUDE.md to reference the `common` crate correctly as a git dependency from `contract-developer-tools` instead of a nonexistent local path. Remove duplicate CLAUDE.md from the instagram template (inherits from common/).

## 0.4.4

### Patch Changes

- bf1003a: Fix deploy dry-run using Alice's address instead of the actual signer

  The deployer was hardcoding ALICE_SS58 as the origin for dry-run gas/storage estimation. On public testnets this caused misleading errors (e.g. StorageDepositNotEnoughFunds) when the actual signer's account state differed from Alice's. Dry-runs now use the real signer's SS58 address.

- Updated dependencies [bf1003a]
  - @dotdm/contracts@0.3.2
  - @dotdm/cdm@0.5.3

## 0.4.3

### Patch Changes

- Updated dependencies [6e9633a]
  - @dotdm/cdm@0.5.2
  - @dotdm/env@0.3.1
  - @dotdm/utils@0.3.1
  - @dotdm/contracts@0.3.1

## 0.4.2

### Patch Changes

- Updated dependencies [dc7f2f8]
  - @dotdm/cdm@0.5.1

## 0.4.1

### Patch Changes

- ac58b7c: Show expired bulletin allowance in red with "expired at block #N" instead of dim "expires block #N"

  When the current finalized block number has passed the allowance expiration, the bulletin balance line now displays in red to make it obvious the allowance is no longer usable.

## 0.4.0

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
  - @dotdm/contracts@0.3.0
  - @dotdm/env@0.3.0
  - @dotdm/cdm@0.5.0
  - @dotdm/descriptors@0.1.8

## 0.3.8

### Patch Changes

- eeb3dfe: Release CLI update

## 0.3.7

### Patch Changes

- Updated dependencies [0220329]
  - @dotdm/cdm@0.4.0

## 0.3.6

### Patch Changes

- 693c440: Fall back to plain URLs when the terminal does not support hyperlinks

## 0.3.5

### Patch Changes

- fee0ba2: Patch bump to trigger CI release pipeline
- Updated dependencies [fee0ba2]
  - @dotdm/utils@0.2.7
  - @dotdm/env@0.2.8
  - @dotdm/contracts@0.2.10
  - @dotdm/descriptors@0.1.7
  - @dotdm/cdm@0.3.10

## 0.3.4

### Patch Changes

- 8102a92: Patch bump to trigger CI release pipeline
- Updated dependencies [8102a92]
  - @dotdm/utils@0.2.6
  - @dotdm/env@0.2.7
  - @dotdm/contracts@0.2.9
  - @dotdm/descriptors@0.1.6
  - @dotdm/cdm@0.3.9

## 0.3.3

### Patch Changes

- f573e2e: Chain Docker image build after release workflow

## 0.3.2

### Patch Changes

- 7f93a67: Patch version bump for all packages.
- Updated dependencies [7f93a67]
  - @dotdm/utils@0.2.5
  - @dotdm/env@0.2.6
  - @dotdm/contracts@0.2.8
  - @dotdm/cdm@0.3.8
  - @dotdm/descriptors@0.1.5

## 0.3.1

### Patch Changes

- b4a9361: Patch version bump for all packages.
- Updated dependencies [b4a9361]
  - @dotdm/utils@0.2.4
  - @dotdm/env@0.2.5
  - @dotdm/contracts@0.2.7
  - @dotdm/cdm@0.3.7
  - @dotdm/descriptors@0.1.4

## 0.3.0

### Minor Changes

- 64993ba: `cdm init` now automatically sets up a preview-net account (fund, bulletin authorize, account map) using the same mnemonic as paseo. Contract crate detection now excludes lib-only crates that depend on pvm_contract but have no binary target.

### Patch Changes

- Updated dependencies [64993ba]
  - @dotdm/contracts@0.2.6
  - @dotdm/cdm@0.3.6

## 0.2.4

### Patch Changes

- Updated dependencies [214fa72]
  - @dotdm/env@0.2.4
  - @dotdm/cdm@0.3.5
  - @dotdm/contracts@0.2.5

## 0.2.3

### Patch Changes

- 7507475: Add json-target-spec to .cargo/config.toml for newer nightly Rust compatibility
- Updated dependencies [7507475]
  - @dotdm/utils@0.2.3
  - @dotdm/contracts@0.2.4
  - @dotdm/env@0.2.3
  - @dotdm/cdm@0.3.4
  - @dotdm/descriptors@0.1.3

## 0.2.2

### Patch Changes

- ef832d0: updated template
- Updated dependencies [ef832d0]
  - @dotdm/utils@0.2.2
  - @dotdm/contracts@0.2.3
  - @dotdm/env@0.2.2
  - @dotdm/cdm@0.3.3
  - @dotdm/descriptors@0.1.2

## 0.2.1

### Patch Changes

- Updated dependencies [84038ac]
  - @dotdm/contracts@0.2.2
  - @dotdm/utils@0.2.1
  - @dotdm/cdm@0.3.2
  - @dotdm/env@0.2.1

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
  - @dotdm/env@0.2.0
  - @dotdm/cdm@0.3.1
  - @dotdm/contracts@0.2.1

## 0.1.11

### Patch Changes

- 8173c6e: Make @dotdm/cdm browser-compatible with self-contained cdm.json

  - cdm.json now embeds resolved contract data (ABI, address, version, metadataCid) in a `contracts` field, populated by `cdm install`
  - New browser-safe Cdm class reads from in-memory cdm.json instead of ~/.cdm/ filesystem
  - Added `browser` conditional export so bundlers (Vite/webpack/esbuild) pick the right entry
  - CdmJson `dependencies` type widened to `number | string` for JSON import compatibility
  - Reverted @dotdm/contracts to single `.` export (subpath exports no longer needed)
  - TypeScript codegen now reads ABIs from cdm.json instead of resolving from disk

- Updated dependencies [8173c6e]
  - @dotdm/cdm@0.3.0
  - @dotdm/contracts@0.2.0

## 0.1.10

### Patch Changes

- Updated dependencies [c534754]
  - @dotdm/cdm@0.2.3

## 0.1.9

### Patch Changes

- 787ae34: Add rust-toolchain.toml to shared-counter template to fix builds on stable Rust

## 0.1.8

### Patch Changes

- Updated dependencies [00add1d]
  - @dotdm/env@0.1.3
  - @dotdm/cdm@0.2.2
  - @dotdm/contracts@0.1.4

## 0.1.7

### Patch Changes

- Updated dependencies [31a8e60]
  - @dotdm/cdm@0.2.1

## 0.1.6

### Patch Changes

- Updated dependencies [af2bb25]
  - @dotdm/cdm@0.2.0

## 0.1.5

### Patch Changes

- aff8405: Fix install crash when contract not found in registry. Show friendly error instead of raw ABI decoding error, and skip unresolved contracts during post-install type generation.

## 0.1.4

### Patch Changes

- f52bebb: Improved templates

## 0.1.3

### Patch Changes

- ca62f88: Refactor install command with Ink-based table UI matching deploy command style. Run contract installs in parallel with animated spinners and progress display. Extract shared visual components (Spinner, Link, Cell, etc.) into a shared component library. Rename pipeline.ts to deploy-pipeline.ts for consistency. Silence papi "Incompatible runtime entry" stderr noise on preview-net. Restructure shared-counter template to combine Rust and TypeScript into a single project root with cdm crate dependency.

## 0.1.2

### Patch Changes

- Updated dependencies [c81cf62]
  - @dotdm/cdm@0.1.3
  - @dotdm/contracts@0.1.3

## 0.1.1

### Patch Changes

- 996baee: Move papi descriptors into publishable @dotdm/descriptors package so external npm consumers can resolve chain descriptor imports
- Updated dependencies [996baee]
  - @dotdm/descriptors@0.1.1
  - @dotdm/utils@0.1.2
  - @dotdm/env@0.1.2
  - @dotdm/contracts@0.1.2
  - @dotdm/cdm@0.1.2
