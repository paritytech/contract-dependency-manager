# @dotdm/cdm

## 0.3.8

### Patch Changes

- 7f93a67: Patch version bump for all packages.
- Updated dependencies [7f93a67]
  - @dotdm/utils@0.2.5
  - @dotdm/env@0.2.6
  - @dotdm/contracts@0.2.8

## 0.3.7

### Patch Changes

- b4a9361: Patch version bump for all packages.
- Updated dependencies [b4a9361]
  - @dotdm/utils@0.2.4
  - @dotdm/env@0.2.5
  - @dotdm/contracts@0.2.7

## 0.3.6

### Patch Changes

- Updated dependencies [64993ba]
  - @dotdm/contracts@0.2.6

## 0.3.5

### Patch Changes

- Updated dependencies [214fa72]
  - @dotdm/env@0.2.4
  - @dotdm/contracts@0.2.5

## 0.3.4

### Patch Changes

- 7507475: Add json-target-spec to .cargo/config.toml for newer nightly Rust compatibility
- Updated dependencies [7507475]
  - @dotdm/utils@0.2.3
  - @dotdm/contracts@0.2.4
  - @dotdm/env@0.2.3

## 0.3.3

### Patch Changes

- ef832d0: updated template
- Updated dependencies [ef832d0]
  - @dotdm/utils@0.2.2
  - @dotdm/contracts@0.2.3
  - @dotdm/env@0.2.2

## 0.3.2

### Patch Changes

- Updated dependencies [84038ac]
  - @dotdm/contracts@0.2.2
  - @dotdm/utils@0.2.1
  - @dotdm/env@0.2.1

## 0.3.1

### Patch Changes

- Updated dependencies [ad38eee]
  - @dotdm/utils@0.2.0
  - @dotdm/env@0.2.0
  - @dotdm/contracts@0.2.1

## 0.3.0

### Minor Changes

- 8173c6e: Make @dotdm/cdm browser-compatible with self-contained cdm.json

  - cdm.json now embeds resolved contract data (ABI, address, version, metadataCid) in a `contracts` field, populated by `cdm install`
  - New browser-safe Cdm class reads from in-memory cdm.json instead of ~/.cdm/ filesystem
  - Added `browser` conditional export so bundlers (Vite/webpack/esbuild) pick the right entry
  - CdmJson `dependencies` type widened to `number | string` for JSON import compatibility
  - Reverted @dotdm/contracts to single `.` export (subpath exports no longer needed)
  - TypeScript codegen now reads ABIs from cdm.json instead of resolving from disk

### Patch Changes

- Updated dependencies [8173c6e]
  - @dotdm/contracts@0.2.0

## 0.2.3

### Patch Changes

- c534754: Fix ws-provider import path from `polkadot-api/ws-provider/node` to `polkadot-api/ws-provider`

## 0.2.2

### Patch Changes

- Updated dependencies [00add1d]
  - @dotdm/env@0.1.3
  - @dotdm/contracts@0.1.4

## 0.2.1

### Patch Changes

- 31a8e60: Allow `TxOpts.origin` to override the dry-run caller address, fixing gas estimation failures when a non-Alice wallet signs transactions with caller-dependent assertions.

## 0.2.0

### Minor Changes

- af2bb25: Add `value`, `gasLimit`, and `storageDepositLimit` to `TxOpts`, enabling payable contract method calls and custom gas/storage configuration through CDM's `.tx()` and `.query()` wrappers.

## 0.1.3

### Patch Changes

- c81cf62: Fix readCdmJson to accept both file paths and directory paths. Default signer and origin to Alice in createCdm().
- Updated dependencies [c81cf62]
  - @dotdm/contracts@0.1.3

## 0.1.2

### Patch Changes

- 996baee: Move papi descriptors into publishable @dotdm/descriptors package so external npm consumers can resolve chain descriptor imports
- Updated dependencies [996baee]
  - @dotdm/env@0.1.2
  - @dotdm/contracts@0.1.2

## 0.1.1

### Patch Changes

- d0f0c48: fix: release pipeline configuration
- Updated dependencies [d0f0c48]
  - @dotdm/env@0.1.1
  - @dotdm/contracts@0.1.1

## 0.1.0

### Minor Changes

- eee9eb3: Initial public release of @dotdm packages.

### Patch Changes

- Updated dependencies [eee9eb3]
  - @dotdm/env@0.1.0
  - @dotdm/contracts@0.1.0
