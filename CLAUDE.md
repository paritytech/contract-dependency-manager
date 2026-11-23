# Contract Dependency Manager (CDM)

CLI and web tooling for managing PVM smart contract dependencies on Polkadot. Automates contract deployment ordering, cross-contract address resolution, and TypeScript type generation.

## Workflow Rules

- **Always act as team leader.** The primary agent the user is talking to MUST act as a team leader and delegate work to sub-agents for almost everything.
- **Always use team mode.** You MUST always run agents in team mode (using `TeamCreate` + `Task` with `team_name`) so the user can properly watch their work. Never use standalone agents outside of a team. This applies to ALL agent usage — no exceptions.
- **Always format when done.** After finishing code changes, run `pnpm format` to ensure consistent formatting before presenting results to the user.
- **Always add a changeset for releasable changes.** Any change that affects a publishable workspace package (everything except `@parity/cdm-frontend` and `@parity/cdm-scripts`, per [.changeset/config.json](.changeset/config.json)) requires a changeset file in `.changeset/`. Create it as part of the change — do not wait to be asked. Use `---` frontmatter listing each affected package with `patch`/`minor`/`major`, followed by a one-line summary. Skip only for changes that touch no publishable packages (docs-only, frontend-only, scripts-only, CI/tooling).

## Monorepo Structure

pnpm workspaces + Turbo. Bun for CLI runtime/compilation, pnpm for package management.

```
Cargo.toml                     # Rust workspace root
package.json                   # pnpm workspace root
pnpm-workspace.yaml            # Workspace packages + version catalog
turbo.json                     # Task pipeline
tsconfig.json                  # Base TS config (no outDir/rootDir/jsx)
src/
  apps/
    cli/                       # @parity/cdm-cli — Commander.js CLI (bun runtime)
      src/cli.ts               #   Entry point
      src/commands/             #   build, deploy, install, template
      src/lib/                  #   deploy-pipeline.ts, install-pipeline.ts, ui.ts, components/DeployTable.tsx, InstallTable.tsx, shared.tsx
      src/generated/            #   Auto-generated template embeds (gitignored)
      tests/
    frontend/                  # @parity/cdm-frontend — React 19 SPA (Vite)
  lib/
    utils/                     # @parity/cdm-utils — Shared constants/types
      src/constants.ts         #   ALL constants (ALICE_SS58, GAS_LIMIT, STORAGE_DEPOSIT_LIMIT, CONTRACTS_REGISTRY_CRATE, DEFAULT_NODE_URL)
      src/utils.ts             #   stringifyBigInt
    contracts/                 # @parity/cdm-builder — Contract tooling
      src/detection.ts         #   Workspace scanning, dependency graph, topological sort
      src/deployer.ts          #   Contract deployment via Revive pallet
      src/publisher.ts         #   Metadata publishing to Bulletin chain
      src/pipeline.ts          #   Deploy pipeline (build → plan → publish), registry queries
      src/install.ts           #   Install-time version resolution + registry queries
      src/initializations.ts   #   Version-addressed initializations: file parsing, publish matching, layout guard
      src/proxy.ts             #   Per-name wire format (versioned/meta calls, semver keys, resolve protocol constants)
      src/abi/registry.ts      #   Hand-mirrored registry + EIP-1967 proxy ABIs
      src/abi/resolver.ts      #   Hand-mirrored resolver ABI
      src/builder.ts           #   Cargo build wrapper (cargo pvm-contract build)
      src/cid.ts               #   CID computation
      src/store.ts             #   Project-local .cdm/ artifact persistence
      src/cdm-json.ts          #   Flat cdm.json reading/writing
    env/                       # @parity/cdm-env — Chain environment
      src/connection.ts        #   WebSocket, Smoldot, Bulletin, and IPFS gateway connections
      src/signer.ts            #   sr25519 key derivation (dev accounts)
      src/known_chains.ts      #   Chain presets (polkadot, paseo, preview-net, local)
    scripts/                   # @parity/cdm-scripts — Standalone bun scripts
      embed-templates.ts       #   Generate src/apps/cli/src/generated/templates.ts
      deploy-registry.ts       #   Deploy registry on-chain
      build-registry.sh        #   Build the EIP-1967 proxy, shim factory and shim (mainline cargo-pvm-contract) and the registry + resolver (forge)
      freeze-proxy-artifact.ts #   Rebuild and re-freeze the per-name shim blob
      freeze-create3-artifacts.ts  # Rebuild and re-freeze the CREATE3 factory and child blobs
    cdm/
      rust/                    # cdm crate — re-exports cdm::import!() macro
      rust-macros/             # cdm-macros — Proc-macro crate, provides cdm::import!()
      typescript/              # @parity/cdm-codegen package (stub)
  contract/                    # CDM's on-chain contracts
    solidity/                  # Foundry project — the upgradeable contracts, Solidity compiled to EVM bytecode
      src/Registry.sol         #   ContractRegistry implementation — also creates the per-name shims (through the shim factory) and is the resolver's admin
      src/Resolver.sol         #   Resolver implementation — routing tables + policy for every shim (upgradeable, registry-owned)
      test/                    #   forge tests (Registry.t.sol, Resolver.t.sol, Storage.t.sol) and their test doubles
    host/                      # contract-host — the pallet-revive host calls the Rust contracts make, behind one `Host` trait
    core/                      # contract-registry-core — pure logic shared by the Rust contracts (EIP-1967 slots, wire format, shim state, shim ↔ resolver protocol)
    proxy/                     # contract-proxy — the frozen per-name shim (stable address + storage; serves the latest version itself, asks the resolver for the rest; sealable)
    shim-factory/              # contract-shim-factory — instantiates a name's shim when the registry delegate-calls it
    eip1967-proxy/             # contract-eip1967-proxy — stable address in front of the registry and the resolver
    create3/                   # create3-factory + create3-child — the frozen CREATE3 pair (see its README.md)
  templates/                   # Scaffolding templates (shared-counter, instagram)
  stubs/                       # Stub packages (react-devtools-core)
```

## Workspace Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@parity/cdm-cli` | `src/apps/cli` | CLI tool — runs via bun, compiles to standalone binary |
| `@parity/cdm-frontend` | `src/apps/frontend` | Web dashboard — Vite + React |
| `@parity/cdm-utils` | `src/lib/utils` | Shared constants and utilities |
| `@parity/cdm-builder` | `src/lib/contracts` | Contract deployment, detection, building, publishing, registry, CID, store |
| `@parity/cdm-env` | `src/lib/env` | Chain connections, signer, chain presets |
| `@parity/cdm-scripts` | `src/lib/scripts` | Standalone bun scripts (embed-templates, deploy-registry) |
| `@parity/cdm-codegen` | `src/lib/cdm/typescript` | Stub TS library |
| Foundry project (not a workspace package) | `src/contract/solidity` | The upgradeable contracts, Solidity compiled to EVM bytecode. `Registry.sol` — on-chain ContractRegistry implementation, also the creator of the per-name shims and the resolver's admin. `Resolver.sol` — routing tables + policy for every shim; one upgrade reaches every call a shim asks about |
| `contract-host` | `src/contract/host` | What the Rust contracts share — a `Host` trait over the pallet-revive host functions, its on-chain implementation and panic handler, a few ABI helpers, and a `mock` feature that implements `Host` for the pvm-contract-sdk `MockHost` |
| `contract-registry-core` | `src/contract/core` | Pure logic shared by the Rust contracts — EIP-1967 slots, versioned-call wire format, shim state, shim ↔ resolver protocol |
| `contract-proxy` | `src/contract/proxy` | Per-name shim (frozen) — a contract name's stable address + storage; serves the latest version from its own fast-path slot, asks the resolver about every other call, and can be sealed on one version for good |
| `contract-shim-factory` | `src/contract/shim-factory` | Shim factory — instantiates a PolkaVM contract by code hash for whoever delegate-calls it; the registry uses it to create each name's shim |
| `contract-eip1967-proxy` | `src/contract/eip1967-proxy` | EIP-1967 proxy — the stable address in front of the registry and the resolver |
| `create3-factory`, `create3-child` | `src/contract/create3/factory`, `src/contract/create3/child` | CREATE3 pair (frozen) — deploys a contract at an address that depends only on (factory, salt) |
| `cdm` | `src/lib/cdm/rust` | CDM crate — re-exports cdm::import!() macro |
| `cdm-macros` | `src/lib/cdm/rust-macros` | Proc-macro crate — cdm::import!() resolves ABI from cdm.json |

## Key Commands

```bash
# Setup
pnpm bootstrap                # pnpm install + build template contracts

# Development
pnpm dev                      # Frontend dev server (builds workspace deps first)
bun run src/apps/cli/src/cli.ts  # Run CLI directly

# Building
pnpm build                    # build:ts + build:registry
pnpm build:ts                 # turbo build (all TS workspace packages)
pnpm build:registry           # src/lib/scripts/build-registry.sh: EIP-1967 proxy, shim factory and shim with mainline cargo-pvm-contract, then forge build for the registry and resolver
pnpm build:template           # Build shared-counter template contracts
pnpm compile:cli              # build:ts + embed:templates + compile CLI to dist/cdm
pnpm compile:all              # Cross-compile (darwin-arm64, darwin-x64, linux-x64, linux-arm64)
pnpm install:cli              # compile:cli + copy to ~/.cdm/bin/cdm
pnpm embed:templates          # bun run src/lib/scripts/embed-templates.ts

# Deployment
pnpm deploy:registry -- --name local  # bun run src/lib/scripts/deploy-registry.ts

# Testing
pnpm test                     # vitest + test:macro + test:rust + test:sol
pnpm test:e2e                 # end-to-end tests (requires a running local PPN: `npm install -g @parity/ppn && ppn start --ephemeral` — see src/lib/contracts/tests/e2e/harness.ts)
pnpm test:macro               # Compile cdm::import! consumer to PolkaVM
pnpm test:rust                # Host-side Rust unit tests
pnpm test:sol                 # forge test for the registry and resolver (src/contract/solidity)

# Full gate
pnpm check                    # embed:templates + format:check + typecheck + build + test

# Formatting
pnpm format                   # Format all TS, Rust and Solidity code (biome, cargo fmt, forge fmt)
pnpm format:check             # Check formatting

# Cleanup
pnpm clean                    # turbo clean + rm -rf dist/ target/

# Package management
pnpm install                  # Install all workspace deps
pnpm --filter @parity/cdm-frontend build  # Build specific package
```

## Version Management

All dependency versions are centralized in `pnpm-workspace.yaml` via the `catalog:` protocol. Workspace packages reference each other with `workspace:*`. Never hardcode versions in individual package.json files for catalog-managed packages.

## CLI Architecture

Entry: `src/apps/cli/src/cli.ts` (Commander.js)

**Commands**: `build`, `deploy`, `install`, `template`

**CLI lib modules** (`src/apps/cli/src/lib/`):
- `deploy-pipeline.ts` — CLI-specific build/deploy/register orchestration with layered execution
- `install-pipeline.ts` — Install command query/fetch/save orchestration
- `ui.ts` — Ink terminal UI rendering
- `components/DeployTable.tsx` — Terminal deploy table component
- `components/InstallTable.tsx` — Terminal install table component
- `components/shared.tsx` — Shared terminal UI components

**Shared imports**: CLI imports from `@parity/cdm-builder` (detection, deployer, publisher, pipeline, install, proxy, builder, cid, store, cdm-json), `@parity/cdm-env` (connection, signer, KNOWN_CHAINS, getChainPreset), `@parity/cdm-codegen`, and `@parity/cdm-utils` (all constants, stringifyBigInt). All constants (`ALICE_SS58`, `GAS_LIMIT`, `STORAGE_DEPOSIT_LIMIT`, `CONTRACTS_REGISTRY_CRATE`, `DEFAULT_NODE_URL`) live in `@parity/cdm-utils`.

**Versioning**: a contract's version comes from its crate's `Cargo.toml` `package.version` (strict `X.Y.Z`); `cdm deploy` is idempotent — versions at or below the registry's latest are skipped as up-to-date. Install specs are `latest`, exact semver, or npm-style ranges (`^1.2`), resolved to one exact published version.

**Initializations**: addressed by (contract, version) — Rust `<crate>/initializations/<version>.rs` (built manifest-free via a generated shim crate), Solidity `initializations/<Contract>/<version>.sol` (directory routes, inheritance validates). The matching file deploys with its version's publish and runs `initialize(uint128,address)` once, atomically, in proxy storage; a deploy-time storage-layout guard refuses mismatched initializations.

**Install command**: `cdm install` writes the registry snapshot to flat `cdm.json` (semver version string + the name's stable address) and saves ABI/metadata artifacts to project-local `.cdm/contracts/<name>/<semver>/`. User account data still lives under `~/.cdm/accounts.json`. The install command implementation is split across subfiles: `index.ts`, `typescript.ts`, `rust.ts`.

## Frontend Architecture

React 19 + Vite + React Router DOM (HashRouter). Uses product-sdk descriptors and contract helpers. Uses `@parity/cdm-env` for chain presets and `@parity/cdm-utils` for constants.

**Pages**: HomePage (landing + stats + featured contracts), SearchPage (filtering + sorting), PackagePage (readme, ABI viewer, versions, dependencies)

**Key components**: Header, Layout, PackageCard, NetworkConfig, GrainCanvas

- `NetworkContext.tsx` — Chain connection management, imports `KNOWN_CHAINS`/`ChainPreset` from `@parity/cdm-env`
- `useRegistry.ts` — On-chain contract queries + IPFS metadata fetching (two-phase loading)
- DOMPurify + marked for XSS-safe markdown rendering

## On-Chain Contracts

Two toolchains, both required. The Rust contracts target PolkaVM (`riscv64emac-unknown-none-polkavm`) via `.cargo/config.toml` and need `cargo-pvm-contract` for building. Cannot `cargo check --workspace` without the PolkaVM target toolchain — use `cargo pvm-contract build` instead. The root `Cargo.toml` release profile optimizes for size (`opt-level = "s"`, fat LTO, one codegen unit): every byte of a contract blob is loaded and proven on each call. The Solidity contracts are a Foundry project at `src/contract/solidity/` (`foundry.toml` pins solc 0.8.34 and appends no metadata hash, so identical source gives byte-identical output) and need `forge`: `pnpm build:registry`, `pnpm test`, `pnpm format` and `pnpm format:check` all call it.

The ContractRegistry stores name → semver-versioned history (version keys pack `major<<64|minor<<32|patch` into u128; major is capped at 2^31 − 1 so a key fits 95 bits of the shim's state word) and metadata URIs on-chain, and creates the per-name shims. The upgradeable contracts — the registry and the resolver — are Solidity compiled to EVM bytecode. The contracts that are deployed once and stay — the per-name shim, the EIP-1967 proxy, the CREATE3 factory and child — are Rust on PolkaVM, and so is the shim factory. The Rust contracts are written against `contract-host`, not the pvm-contract-sdk: they enable its `mock` feature from dev-dependencies only, so the SDK is a test-only dependency and none of its code is in a blob.

- `src/contract/solidity/src/Registry.sol` — the registry implementation: `publish(name, versionKey, target, metadataUri)` (strictly-increasing keys; first publish instantiates the name's shim by delegate-calling the shim factory with `salt = keccak256(name)`, the shim code hash and the resolver address as constructor input), `setMinSupported`/`freezeContract`/`setFastPath`/`sealContract` written to the resolver, queries, plus longevity controls: `setCode(address)` (UUPS-style upgrade — repoints the registry proxy, keeping address and state), `getProxyCodeHash()` (the shim blob's hash, the constant `SHIM_CODE_HASH`, pinned to the frozen artifact by a forge test — a new shim blob takes a registry upgrade), `setResolver(address)` (write-once) / `upgradeResolver(address)` (repoints the resolver proxy — one upgrade reaches every call a shim asks about), `freeze()`/`unfreeze()` (blocks all non-admin mutations with `ContractFrozen()`). The constructor takes the shim factory address and keeps it as an immutable.
- `src/contract/proxy/src/main.rs` — `contract-proxy`, the per-name shim: owns a name's permanent address, storage, and balance. Fast path: it keeps the latest version (key + implementation) in its own `FAST_SLOT` and tail-delegate-calls it for plain calls and for calls pinned to that key, and answers the `latest()` meta query from it, without asking the resolver. It answers four meta selectors itself whatever its state — `sealed()`, `resolver()`, and the resolver-only `setFastPath`/`seal` — and forwards every other call to the resolver as `resolve(caller, value, data)` (read-only; the resolver address is pallet immutable data set by the constructor), doing what the `Resolution` says — kind 0 returns the payload, kind 1 delegate-calls `target` with `payload ++ data[strip..]`. Resolver reverts bubble unchanged; anything else is `MalformedResolution()`. Seal: once the sealed bit of the `FAST_SLOT` word is set (irreversible) the shim never asks the resolver again — it serves the sealed version, `latest()` and its two getters, and every other call reverts `Sealed()`. The module doc is the protocol spec; the blob is frozen at `src/contract/proxy/artifacts/` and, once a name is created from it, can never change.
- `src/contract/solidity/src/Resolver.sol` — the resolver implementation, behind an EIP-1967 proxy with the registry as admin: the routing tables (`routing: shim → latest/floor/frozen/fastPathOff/sealed`, `implementations: shim → key → implementation`) and the policy for every call a shim asks about. Plain calldata → latest implementation, `[MAGIC][u128 key]` → that exact version (below the owner's floor → `UnsupportedVersion()`), `[MAGIC][0][selector]` → the CDM meta plane: queries (`implOf`, `latest`, `minSupported`, `frozen`, `admin`) plus `callCode`, honored only when the shim's caller is the registry (the initializations primitive, live while frozen). Mutations (`publish`, `setMinSupported`, `setFrozen`, `setFastPath`, `seal`, `setCode`) are registry-only, and keep each shim's fast-path copy in step: pushed on publish, emptied while the name is frozen or its owner has opted out (`setFastPath(proxy, false)`), and pinned for good by `seal`, after which every mutation of the name reverts `NameSealed()`. Wire format + protocol constants live in `contract-registry-core::versioning` and are mirrored (and drift-tested) in `src/lib/contracts/src/proxy.ts`; `Registry.sol` and `Resolver.sol` declare the ones they use themselves.
- `src/contract/shim-factory/src/main.rs` — `contract-shim-factory`: EVM bytecode cannot create a PolkaVM contract, so the registry delegate-calls this with `[salt][code hash][constructor input]` and gets the new contract's address back as one ABI word. pallet-revive attributes an instantiation made inside a delegate call to the delegating contract, so a shim's address derives from the registry and not from the shim factory. It holds no state and checks no caller. Its address is a constructor argument of the registry implementation, so a new shim factory ships with a registry upgrade.
- `src/contract/eip1967-proxy/src/main.rs` — a method-less EIP-1967 proxy that owns a stable address and tail-delegate-calls everything to the implementation; one instance fronts the registry, one the resolver. Deployed through the CREATE3 factory with `(implementation, admin)` constructor args (`src/lib/contracts/src/registry-deploy.ts`); the registry proxy address is the registry address consumers use.
- `src/contract/create3/` — `create3-factory` and `create3-child`, the frozen pair that gives both proxies an address depending only on (factory, salt); see `src/contract/create3/README.md`.
- `src/contract/host/` — `contract-host`, what the Rust contracts are written against: the `Host` trait over the pallet-revive host functions (`pallet-revive-uapi`), `Chain` (its on-chain implementation) and the panic handler every blob needs, the `abi` helpers for reading calldata by hand, and the `mock` feature, which implements `Host` for the pvm-contract-sdk `MockHost`.
- `src/contract/core/` — `contract-registry-core`, host-independent logic shared by the Rust contracts (the EIP-1967 implementation and admin slot constants, versioned-call wire format, the shim's slot and meta selectors, the `resolve` request/response layout) unit-tested with plain `cargo test`.

Registry deploys and upgrades (`src/lib/contracts/src/registry-deploy.ts`; its header comment is the exact sequence) find their build outputs through `registryArtifacts(rootDir)`: forge's artifacts for the registry and the resolver, whose EVM creation code goes on-chain by plain CREATE2, and the EIP-1967 proxy and shim factory blobs under `target/release/`. The shim factory is deployed before the registry implementation, which takes its address as constructor argument.

The shim blob (`src/contract/proxy/artifacts/`) and the two CREATE3 blobs (`src/contract/create3/artifacts/`) are frozen: committed, hash-pinned by the `manifest.json` beside them, and the bytes a deploy uploads. A regenerated blob has a new code hash, and every address derived from it moves. Regenerate one only with `src/lib/scripts/freeze-proxy-artifact.ts` or `src/lib/scripts/freeze-create3-artifacts.ts`, then update the hash constants by hand: `CONTRACT_PROXY_CODE_HASH` (`src/lib/contracts/src/proxy-artifacts.ts`) and `SHIM_CODE_HASH` (`Registry.sol`) for the shim, `CREATE3_CHILD_CODE_HASH` and `CREATE3_FACTORY_CODE_HASH` (`src/lib/contracts/src/create3.ts`) for the CREATE3 pair.

Admin/upgrade state (admin, implementation, frozen) lives at fixed EIP-1967-style slots, and everything else the registry and the resolver store sits in one ERC-7201 struct each (`cdm.registry.v1`, `cdm.resolver.v1`); an upgraded implementation reads the same keys again, and `test/Storage.t.sol` pins every key a first publish writes. The shim's own slot sits at `keccak256(label) - 1` too, so user contracts behind it keep plain auto-numbered slots and need no slot attributes at all. The Rust contracts' unit tests run on the host via `MockHost` and are included in `pnpm test:rust`; the Solidity contracts' tests run under forge (`pnpm test:sol`), with Solidity doubles standing in for the shim and the shim factory, which are PolkaVM contracts forge cannot run. The dispatch-level tests at the end of `src/contract/solidity/test/Registry.t.sol` lock the `getAddress(string)` selector + 64-byte return layout that `pvm-cdm-macros` hardcodes, and `Registry.t.sol` and `Resolver.t.sol` compare the registry→resolver/shim calldata, the `resolve` request and its answer as raw bytes — do not change those wire formats without updating every side. A call to the registry or the resolver with an unknown selector or calldata that does not decode reverts with empty data.

## Testing

Tests use `vitest`. Run from project root:
- `detection.test.ts` — Contract detection, dependency graph, toposort (at `src/lib/contracts/tests/`)
- `commands.test.ts` — CLI help output, template scaffolding (at `src/apps/cli/tests/`)
- `registry-abi-sync.test.ts` — the hand-written registry and resolver ABI mirrors (`src/abi/registry.ts`, `src/abi/resolver.ts`) against forge's artifacts (at `src/lib/contracts/tests/`); skipped locally when `pnpm build:registry` has not run, a failure in CI

The on-chain contracts have their own suites: `pnpm test:rust` (host-side `cargo test`) for the Rust contracts and `pnpm test:sol` (`forge test`) for the registry and resolver.

## Path Conventions

- Template files live at `src/templates/`, embedded at build time into `src/apps/cli/src/generated/`
- Stubs (e.g., react-devtools-core) at `src/stubs/`
- No local papi codegen: typed chain APIs/descriptors come prebuilt from `@parity/product-sdk-descriptors` (e.g. `@parity/product-sdk-descriptors/paseo-asset-hub`), version-pinned in the `pnpm-workspace.yaml` catalog
- Rust build artifacts at `target/` (project root, shared by Cargo workspace)
- Forge build output at `src/contract/solidity/out/` (gitignored, with `cache/`)
- Local imports use no `.js` extensions (moduleResolution: "bundler"); exception: `@noble/hashes/blake2.js`
- From `src/apps/cli/tests/`: `../../../..` = project root, `../../..` = `src/`
