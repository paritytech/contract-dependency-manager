# @dotdm/contracts

## 0.2.2

### Patch Changes

- 84038ac: Add error handling to ContractRegistry and fix registry crate name constant

  - Contract: `publish_latest` now reverts with `Unauthorized` / `VersionOverflow` instead of silently returning
  - `registry.ts`: `register()` checks for `ExtrinsicFailed` events after submission
  - Fix `CONTRACTS_REGISTRY_CRATE` constant from `"contracts"` to `"contract-registry"`

- Updated dependencies [84038ac]
  - @dotdm/utils@0.2.1
  - @dotdm/env@0.2.1

## 0.2.1

### Patch Changes

- Updated dependencies [ad38eee]
  - @dotdm/utils@0.2.0
  - @dotdm/env@0.2.0

## 0.2.0

### Minor Changes

- 8173c6e: Make @dotdm/cdm browser-compatible with self-contained cdm.json

  - cdm.json now embeds resolved contract data (ABI, address, version, metadataCid) in a `contracts` field, populated by `cdm install`
  - New browser-safe Cdm class reads from in-memory cdm.json instead of ~/.cdm/ filesystem
  - Added `browser` conditional export so bundlers (Vite/webpack/esbuild) pick the right entry
  - CdmJson `dependencies` type widened to `number | string` for JSON import compatibility
  - Reverted @dotdm/contracts to single `.` export (subpath exports no longer needed)
  - TypeScript codegen now reads ABIs from cdm.json instead of resolving from disk

## 0.1.4

### Patch Changes

- Updated dependencies [00add1d]
  - @dotdm/env@0.1.3

## 0.1.3

### Patch Changes

- c81cf62: Fix readCdmJson to accept both file paths and directory paths. Default signer and origin to Alice in createCdm().

## 0.1.2

### Patch Changes

- 996baee: Move papi descriptors into publishable @dotdm/descriptors package so external npm consumers can resolve chain descriptor imports
- Updated dependencies [996baee]
  - @dotdm/descriptors@0.1.1
  - @dotdm/utils@0.1.2
  - @dotdm/env@0.1.2

## 0.1.1

### Patch Changes

- d0f0c48: fix: release pipeline configuration
- Updated dependencies [d0f0c48]
  - @dotdm/utils@0.1.1
  - @dotdm/env@0.1.1

## 0.1.0

### Minor Changes

- eee9eb3: Initial public release of @dotdm packages.

### Patch Changes

- Updated dependencies [eee9eb3]
  - @dotdm/utils@0.1.0
  - @dotdm/env@0.1.0
