# @dotdm/cli

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
