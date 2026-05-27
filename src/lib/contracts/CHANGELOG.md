# @dotdm/contracts

## 3.1.0

### Minor Changes

- 6339b1a: Expose a reusable `installContracts` pipeline from `@dotdm/contracts` and refactor the CLI install UI to consume install events instead of owning registry query and metadata persistence logic.

## 3.0.0

### Major Changes

- b1a6671: Remove the deprecated `REGISTRY_ADDRESS` export and route registry resolution through `@dotdm/env`'s `getRegistryAddress(name)`.

  `getRegistryAddress()` now defaults to the current Paseo registry, so build/deploy/install paths and lower-level helpers no longer fall back to the old deterministic registry address. Templates and target hashes have been updated to the current registry as well.

### Patch Changes

- Updated dependencies [b1a6671]
  - @dotdm/env@2.0.0
  - @dotdm/utils@0.4.0

## 2.2.1

### Patch Changes

- 98f96e8: Trigger release for `@dotdm/contracts`.

## 2.2.0

### Minor Changes

- 9635da9: Add a `metadataSigner` deploy option for hosts that use separate Asset Hub and Bulletin signing accounts.

## 2.1.3

### Patch Changes

- 83696a6: Add registry package-name search support and fix redeploying CDM packages against fresh registry deployments.

  `@dotdm/contracts` now includes the registry `searchContractNames` ABI, scopes package deployment salts by registry address, and avoids dry-running dependent layers before prior layers have been registered. `@dotdm/utils` exposes the registry package salt constant used by deploy scripts and bootstrap deploys. `@dotdm/env` points presets at the redeployed registry address.

- Updated dependencies [83696a6]
  - @dotdm/env@1.0.6
  - @dotdm/utils@0.3.2

## 2.1.2

### Patch Changes

- Updated dependencies [c12538f]
  - @dotdm/env@1.0.5

## 2.1.1

### Patch Changes

- 40949ac: Generate local Solidity CDM build stubs before compiling Hardhat and Foundry projects, and publish richer Solidity contract metadata from NatSpec and per-contract README files.

## 2.1.0

### Minor Changes

- ff4acdd: Generate robust Solidity CDM import files from installed contract ABIs.

## 2.0.4

### Patch Changes

- d2867e3: Add `cdm build` support for Foundry and Hardhat Solidity projects, including reusable package APIs for toolchain detection, compilation, and normalized PolkaVM bytecode artifacts.

## 2.0.3

### Patch Changes

- Updated dependencies [32ed48b]
  - @dotdm/env@1.0.4

## 2.0.2

### Patch Changes

- 0ef910a: Update CDM's Paseo preset to Paseo Next v2 and upgrade product-sdk packages to the 0.4 release line. Contract registry handles now pass product-sdk descriptors into the 0.4 contract runtime factories, and batched registry publishes await async `.prepare()` calls.

  The Paseo preset now points at the ContractRegistry deployed on Paseo Next v2, and `make deploy-registry` refreshes local package builds before running the deployment script. Re-running `deploy-registry` exits successfully when the selected registry is already deployed.

- Updated dependencies [0ef910a]
  - @dotdm/env@1.0.3

## 2.0.1

### Patch Changes

- 11c7611: Make the ContractRegistry address part of CDM network target selection again, including cdm.json target hashing, build-time registry embedding, deploy/install registry resolution, and preview-net presets.
- e159d8e: Update CDM packages and templates to the latest published product-sdk packages, including the new paseo/preview-net descriptor split for Asset Hub and Bulletin.
- Updated dependencies [11c7611]
- Updated dependencies [e159d8e]
  - @dotdm/env@1.0.2

## 2.0.0

### Major Changes

- a26d3ca: Migrate CDM runtime and templates from `@polkadot-apps` packages to the published `@parity/product-sdk` packages.

  `@dotdm/contracts` now uses product-sdk contracts for registry contract handles and `.prepare()` calls, product-sdk bulletin for metadata publishing, and product-sdk-compatible CID precomputation.

  `@dotdm/cdm` now emits product-sdk contract module augmentations for `.cdm/contracts.d.ts`.

  `@dotdm/env` now uses product-sdk descriptors for CDM chain connections.

  `@dotdm/cli` now installs and deploys through the product-sdk-backed runtime path.

### Patch Changes

- Updated dependencies [a26d3ca]
  - @dotdm/env@1.0.1

## 1.1.1

### Patch Changes

- 3294d7f: Use the next CDM registry version index in CREATE2 salts so repeated publishes of the same package deploy to fresh deterministic addresses. CDM deploys now query registry version counts instead of skipping identical bytecode as cached, allowing intentional new registry versions even when bytecode is unchanged.

## 1.1.0

### Minor Changes

- 11c598b: Support passing `--features` to `cdm build` and `cdm deploy` (forwarded to `cargo pvm-contract build`), useful for compile-time switches such as choosing a contract name via a `dev` feature. Defaults can be set in a gitignored `cdm.local.json` so each developer can keep their own feature set without polluting the repo.

## 1.0.1

### Patch Changes

- 8adb0a9: Read dry-run state at `"best"` instead of polkadot-api's `"finalized"` default for `ReviveApi.instantiate` calls (`ContractDeployer.dryRunDeploy` and the pipeline's `check-needs-deploy` probe). Fixes a race where a caller that just ran `Revive.map_account` (or any prerequisite state change) at best-block would see `AccountUnmapped` from `dryRunDeploy` until finality caught up ~12–24s later. Best-block is correct semantically: when the real deploy tx lands it'll execute on a future best block that also includes the mapping, so the estimate matches execution.

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

- 5c2884c: Adopt the new `@polkadot-apps/contracts` `.prepare()` API (v0.4.0) for building batchable ink calls, drop the direct `@polkadot-api/sdk-ink` dependency, and remove the `RegistryManager` wrapper.

  - Bump `@polkadot-apps/contracts` catalog to `^0.4.0`.
  - `ContractDeployer.deployAndRegisterBatch(...)` now accepts a `Contract<ContractDef>` (from `@polkadot-apps/contracts`) and uses `contract.publishLatest.prepare(...)` to build `BatchableCall`s for `batchSubmitAndWatch`, removing the previous `@polkadot-api/sdk-ink` `registry.send(...)` drop-down.
  - `RegistryManager` and its related exports (`getRegistryContract`, `RegistryContract`) have been removed from `@dotdm/contracts`. The class was a thin wrapper whose only consumer was the internal pipeline; the registry `Contract` is now constructed inline in `deployContracts()` via `createContractFromClient`.
  - Removes `@polkadot-api/sdk-ink` from `@dotdm/contracts`'s direct dependencies (still pulled transitively by `@polkadot-apps/contracts`' `createContractFromClient`).

### Patch Changes

- Updated dependencies [428a9a6]
  - @dotdm/env@1.0.0

## 0.4.0

### Minor Changes

- 842d557: feat: smart deploy caching — skip unchanged contracts

  Contracts that are already deployed on-chain with identical bytecode are now skipped during `cdm deploy`. After building, the pipeline compares local `.polkavm` bytecode against on-chain pristine code (via `AccountInfoOf` + `PristineCode` storage). Matching bytecode shows as cached (`~`) in the deploy table. This is signer-independent — cache hits work regardless of which account originally deployed.

  Also fixes the `@dotdm/descriptors` package failing in CI by removing the unused `file:generated` dependency.

### Patch Changes

- Updated dependencies [842d557]
  - @dotdm/descriptors@0.1.9
  - @dotdm/env@0.3.2

## 0.3.2

### Patch Changes

- bf1003a: Fix deploy dry-run using Alice's address instead of the actual signer

  The deployer was hardcoding ALICE_SS58 as the origin for dry-run gas/storage estimation. On public testnets this caused misleading errors (e.g. StorageDepositNotEnoughFunds) when the actual signer's account state differed from Alice's. Dry-runs now use the real signer's SS58 address.

## 0.3.1

### Patch Changes

- 6e9633a: Fix Node.js ESM compatibility by switching library builds from tsc to tsup. Compiled output now includes proper .js extensions on relative imports, making packages work in both bundler and Node.js ESM environments.
- Updated dependencies [6e9633a]
  - @dotdm/env@0.3.1
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
  - @dotdm/env@0.3.0
  - @dotdm/descriptors@0.1.8

## 0.2.10

### Patch Changes

- fee0ba2: Patch bump to trigger CI release pipeline
- Updated dependencies [fee0ba2]
  - @dotdm/utils@0.2.7
  - @dotdm/env@0.2.8
  - @dotdm/descriptors@0.1.7

## 0.2.9

### Patch Changes

- 8102a92: Patch bump to trigger CI release pipeline
- Updated dependencies [8102a92]
  - @dotdm/utils@0.2.6
  - @dotdm/env@0.2.7
  - @dotdm/descriptors@0.1.6

## 0.2.8

### Patch Changes

- 7f93a67: Patch version bump for all packages.
- Updated dependencies [7f93a67]
  - @dotdm/utils@0.2.5
  - @dotdm/env@0.2.6
  - @dotdm/descriptors@0.1.5

## 0.2.7

### Patch Changes

- b4a9361: Patch version bump for all packages.
- Updated dependencies [b4a9361]
  - @dotdm/utils@0.2.4
  - @dotdm/env@0.2.5
  - @dotdm/descriptors@0.1.4

## 0.2.6

### Patch Changes

- 64993ba: `cdm init` now automatically sets up a preview-net account (fund, bulletin authorize, account map) using the same mnemonic as paseo. Contract crate detection now excludes lib-only crates that depend on pvm_contract but have no binary target.

## 0.2.5

### Patch Changes

- Updated dependencies [214fa72]
  - @dotdm/env@0.2.4

## 0.2.4

### Patch Changes

- 7507475: Add json-target-spec to .cargo/config.toml for newer nightly Rust compatibility
- Updated dependencies [7507475]
  - @dotdm/utils@0.2.3
  - @dotdm/env@0.2.3
  - @dotdm/descriptors@0.1.3

## 0.2.3

### Patch Changes

- ef832d0: updated template
- Updated dependencies [ef832d0]
  - @dotdm/utils@0.2.2
  - @dotdm/env@0.2.2
  - @dotdm/descriptors@0.1.2

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
