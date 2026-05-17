# @dotdm/env

## 1.0.5

### Patch Changes

- c12538f: Add a lightweight registry export for frontend consumers.

## 1.0.4

### Patch Changes

- 32ed48b: Use the Paseo v2 Bulletin IPFS gateway path that actually serves CIDs.

## 1.0.3

### Patch Changes

- 0ef910a: Update CDM's Paseo preset to Paseo Next v2 and upgrade product-sdk packages to the 0.4 release line. Contract registry handles now pass product-sdk descriptors into the 0.4 contract runtime factories, and batched registry publishes await async `.prepare()` calls.

  The Paseo preset now points at the ContractRegistry deployed on Paseo Next v2, and `make deploy-registry` refreshes local package builds before running the deployment script. Re-running `deploy-registry` exits successfully when the selected registry is already deployed.

## 1.0.2

### Patch Changes

- 11c7611: Make the ContractRegistry address part of CDM network target selection again, including cdm.json target hashing, build-time registry embedding, deploy/install registry resolution, and preview-net presets.
- e159d8e: Update CDM packages and templates to the latest published product-sdk packages, including the new paseo/preview-net descriptor split for Asset Hub and Bulletin.

## 1.0.1

### Patch Changes

- a26d3ca: Migrate CDM runtime and templates from `@polkadot-apps` packages to the published `@parity/product-sdk` packages.

  `@dotdm/contracts` now uses product-sdk contracts for registry contract handles and `.prepare()` calls, product-sdk bulletin for metadata publishing, and product-sdk-compatible CID precomputation.

  `@dotdm/cdm` now emits product-sdk contract module augmentations for `.cdm/contracts.d.ts`.

  `@dotdm/env` now uses product-sdk descriptors for CDM chain connections.

  `@dotdm/cli` now installs and deploys through the product-sdk-backed runtime path.

## 1.0.0

### Major Changes

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
