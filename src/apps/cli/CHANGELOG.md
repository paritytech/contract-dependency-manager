# @dotdm/cli

## 0.8.23

### Patch Changes

- Updated dependencies [02c7e06]
  - @parity/cdm-builder@3.1.7
  - @parity/cdm-codegen@0.6.20

## 0.8.22

### Patch Changes

- Updated dependencies [083bc41]
  - @parity/cdm-env@2.0.6
  - @parity/cdm-codegen@0.6.19
  - @parity/cdm-builder@3.1.6

## 0.8.21

### Patch Changes

- 65742ed: Fix deploy/install link display in terminals without OSC 8 hyperlink support. Instead of squeezing the full URL into a narrow table column (where it wrapped into an unreadable smear), the cell now keeps the short hash and the full link is printed on its own line below the row.

## 0.8.20

### Patch Changes

- 9f40bc9: Add a W3S chain preset with Summit RPC endpoints and placeholder registry/IPFS configuration.
- Updated dependencies [9f40bc9]
  - @parity/cdm-env@2.0.5
  - @parity/cdm-codegen@0.6.18
  - @parity/cdm-builder@3.1.5

## 0.8.19

### Patch Changes

- 1ec36d8: Rename CDM workspace packages from the `@dotdm/*` scope to `@parity/cdm-*`.
- Updated dependencies [1ec36d8]
  - @parity/cdm-codegen@0.6.17
  - @parity/cdm-builder@3.1.4
  - @parity/cdm-env@2.0.4
  - @parity/cdm-utils@0.4.1

## 0.8.18

### Patch Changes

- 6eccbfa: Bump `@parity/product-sdk-*` packages (chain-client 0.5.3, contracts 0.7.0, descriptors 0.5.2, host 0.6.1, keys 0.3.3, signer 0.6.0, tx 0.2.7) and align `polkadot-api` to `^2.1.5` to match their peer requirement.
- Updated dependencies [6eccbfa]
  - @dotdm/contracts@3.1.3
  - @dotdm/env@2.0.3
  - @dotdm/cdm@0.6.16

## 0.8.17

### Patch Changes

- Updated dependencies [01d23ce]
  - @dotdm/env@2.0.2
  - @dotdm/contracts@3.1.2
  - @dotdm/cdm@0.6.15

## 0.8.16

### Patch Changes

- Updated dependencies [002400b]
  - @dotdm/env@2.0.1
  - @dotdm/contracts@3.1.1
  - @dotdm/cdm@0.6.14

## 0.8.15

### Patch Changes

- 6339b1a: Expose a reusable `installContracts` pipeline from `@dotdm/contracts` and refactor the CLI install UI to consume install events instead of owning registry query and metadata persistence logic.
- Updated dependencies [6339b1a]
  - @dotdm/contracts@3.1.0
  - @dotdm/cdm@0.6.13

## 0.8.14

### Patch Changes

- Updated dependencies [b1a6671]
  - @dotdm/contracts@3.0.0
  - @dotdm/env@2.0.0
  - @dotdm/utils@0.4.0
  - @dotdm/cdm@0.6.12

## 0.8.13

### Patch Changes

- Updated dependencies [98f96e8]
  - @dotdm/contracts@2.2.1
  - @dotdm/cdm@0.6.11

## 0.8.12

### Patch Changes

- Updated dependencies [9635da9]
  - @dotdm/contracts@2.2.0
  - @dotdm/cdm@0.6.10

## 0.8.11

### Patch Changes

- Updated dependencies [83696a6]
  - @dotdm/contracts@2.1.3
  - @dotdm/env@1.0.6
  - @dotdm/utils@0.3.2
  - @dotdm/cdm@0.6.9

## 0.8.10

### Patch Changes

- Updated dependencies [c12538f]
  - @dotdm/env@1.0.5
  - @dotdm/cdm@0.6.8
  - @dotdm/contracts@2.1.2

## 0.8.9

### Patch Changes

- 40949ac: Generate local Solidity CDM build stubs before compiling Hardhat and Foundry projects, and publish richer Solidity contract metadata from NatSpec and per-contract README files.
- Updated dependencies [40949ac]
  - @dotdm/contracts@2.1.1
  - @dotdm/cdm@0.6.7

## 0.8.8

### Patch Changes

- Updated dependencies [ff4acdd]
  - @dotdm/contracts@2.1.0
  - @dotdm/cdm@0.6.6

## 0.8.7

### Patch Changes

- 7036abb: Add first-pass Hardhat and Foundry Solidity counter templates.
- d2867e3: Add `cdm build` support for Foundry and Hardhat Solidity projects, including reusable package APIs for toolchain detection, compilation, and normalized PolkaVM bytecode artifacts.
- Updated dependencies [d2867e3]
  - @dotdm/contracts@2.0.4
  - @dotdm/cdm@0.6.5

## 0.8.6

### Patch Changes

- 60c96f7: Default `cdm template <name>` to scaffold into `./<name>` and allow explicit target directories, including `.` for the current directory.

## 0.8.5

### Patch Changes

- 34d6e12: Refresh template documentation and app examples for product-sdk contract usage instead of frontend/runtime `@dotdm/cdm` imports.

## 0.8.4

### Patch Changes

- 32ed48b: Use the Paseo v2 Bulletin IPFS gateway path that actually serves CIDs.
- Updated dependencies [32ed48b]
  - @dotdm/env@1.0.4
  - @dotdm/cdm@0.6.4
  - @dotdm/contracts@2.0.3

## 0.8.3

### Patch Changes

- 0ef910a: Update CDM's Paseo preset to Paseo Next v2 and upgrade product-sdk packages to the 0.4 release line. Contract registry handles now pass product-sdk descriptors into the 0.4 contract runtime factories, and batched registry publishes await async `.prepare()` calls.

  The Paseo preset now points at the ContractRegistry deployed on Paseo Next v2, and `make deploy-registry` refreshes local package builds before running the deployment script. Re-running `deploy-registry` exits successfully when the selected registry is already deployed.

- Updated dependencies [0ef910a]
  - @dotdm/cdm@0.6.3
  - @dotdm/contracts@2.0.2
  - @dotdm/env@1.0.3

## 0.8.2

### Patch Changes

- 11c7611: Make the ContractRegistry address part of CDM network target selection again, including cdm.json target hashing, build-time registry embedding, deploy/install registry resolution, and preview-net presets.
- e159d8e: Update CDM packages and templates to the latest published product-sdk packages, including the new paseo/preview-net descriptor split for Asset Hub and Bulletin.
- Updated dependencies [11c7611]
- Updated dependencies [e159d8e]
  - @dotdm/contracts@2.0.1
  - @dotdm/env@1.0.2
  - @dotdm/cdm@0.6.2

## 0.8.1

### Patch Changes

- Updated dependencies [9ca61eb]
  - @dotdm/cdm@0.6.1

## 0.8.0

### Minor Changes

- a26d3ca: Migrate CDM runtime and templates from `@polkadot-apps` packages to the published `@parity/product-sdk` packages.

  `@dotdm/contracts` now uses product-sdk contracts for registry contract handles and `.prepare()` calls, product-sdk bulletin for metadata publishing, and product-sdk-compatible CID precomputation.

  `@dotdm/cdm` now emits product-sdk contract module augmentations for `.cdm/contracts.d.ts`.

  `@dotdm/env` now uses product-sdk descriptors for CDM chain connections.

  `@dotdm/cli` now installs and deploys through the product-sdk-backed runtime path.

### Patch Changes

- Updated dependencies [a26d3ca]
  - @dotdm/contracts@2.0.0
  - @dotdm/cdm@0.6.0
  - @dotdm/env@1.0.1

## 0.7.1

### Patch Changes

- 3294d7f: Use the next CDM registry version index in CREATE2 salts so repeated publishes of the same package deploy to fresh deterministic addresses. CDM deploys now query registry version counts instead of skipping identical bytecode as cached, allowing intentional new registry versions even when bytecode is unchanged.
- Updated dependencies [3294d7f]
  - @dotdm/contracts@1.1.1
  - @dotdm/cdm@0.5.8

## 0.7.0

### Minor Changes

- 11c598b: Support passing `--features` to `cdm build` and `cdm deploy` (forwarded to `cargo pvm-contract build`), useful for compile-time switches such as choosing a contract name via a `dev` feature. Defaults can be set in a gitignored `cdm.local.json` so each developer can keep their own feature set without polluting the repo.

### Patch Changes

- Updated dependencies [11c598b]
  - @dotdm/contracts@1.1.0
  - @dotdm/cdm@0.5.7

## 0.6.1

### Patch Changes

- Updated dependencies [8adb0a9]
  - @dotdm/contracts@1.0.1
  - @dotdm/cdm@0.5.6

## 0.6.0

### Minor Changes

- 428a9a6: Migrate cdm internals onto the `@polkadot-apps` stack and expose a programmatic deploy/build API.

  **`@dotdm/contracts`** — new public API + internal rewrites:

  - Adds `buildContracts(opts)` and `deployContracts(opts)` as the primary library entry points. Both emit typed event streams (`BuildEvent`, `DeployEvent`) and return structured summaries (`BuildSummary`, `DeploySummary`) — suitable for consumers that want to render their own UI on top.
  - `deployContracts()` accepts an injected `ChainClient` (from `@polkadot-apps/chain-client`) and a raw `PolkadotSigner`, so callers manage their own connections and signing strategy. No more hardcoded `~/.cdm/accounts.json` path inside the library.
  - Combines deploy + register into a single AssetHub `batch_all` tx per layer (using CREATE2 address precomputation), and runs it in parallel with Bulletin metadata publish (using locally-precomputed CIDs). Typical deploy drops from ~3 signatures per contract to ~2 signatures per layer.
  - `MetadataPublisher` now delegates to `@polkadot-apps/bulletin` (`upload` / `batchUpload`). Bulletin uploads are sequential per item (chain nonce-ordering requirement) — this matches `@polkadot-apps/bulletin`'s model and replaces the previous single-tx `Utility.batch_all` approach on Bulletin.
  - `RegistryManager` now delegates reads through `@polkadot-apps/contracts` (`createContract`) and writes through `@polkadot-apps/tx` (`batchSubmitAndWatch`).
  - `ContractDeployer` submits via `@polkadot-apps/tx` (`submitAndWatch` / `batchSubmitAndWatch`), inheriting atBest, timeouts, retry helpers, and `onStatus` hooks. CREATE2 salt derivation and `Revive.instantiate_with_code` call construction stay in-house.

  **`@dotdm/env`** — connection layer rewritten:

  - Adds `createCdmChainClient(chainName | {assethubUrl, bulletinUrl})` and `createCdmAssetHubClient(assethubUrl)` backed by `@polkadot-apps/chain-client`'s `createChainClient` (BYOD mode, using cdm's `KNOWN_CHAINS` registry).
  - Removes `connectAssetHubWebSocket`, `connectBulletinWebSocket`, `connectSmoldot`. All call sites updated.
  - `connectIpfsGateway` retained (covers `local` / `preview-net` networks not in `@polkadot-apps/bulletin.getGateway()`).
  - Signer helpers (`prepareSigner*`) unchanged.

  **`@dotdm/cli`** — internal refactor only, no user-facing CLI changes:

  - `cdm build` and `cdm deploy` now consume `buildContracts()` / `deployContracts()` from `@dotdm/contracts`. Ink TUI (`DeployTable.tsx`) subscribes to the event stream via a thin `PipelineStatusAdapter`.
  - Removes the temporary sequential-deploy patch in `detection.ts` — contracts in the same dependency layer now deploy in parallel.

### Patch Changes

- Updated dependencies [428a9a6]
- Updated dependencies [5c2884c]
  - @dotdm/contracts@1.0.0
  - @dotdm/env@1.0.0
  - @dotdm/cdm@0.5.5

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
