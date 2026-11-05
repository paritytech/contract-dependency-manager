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
      build-registry.sh        #   Build registry impl, EIP-1967 proxy, resolver and shim with mainline cargo-pvm-contract
    cdm/
      rust/                    # cdm crate — re-exports cdm::import!() macro
      rust-macros/             # cdm-macros — Proc-macro crate, provides cdm::import!()
      typescript/              # @parity/cdm-codegen package (stub)
  contract/                    # contract-registry Rust crate (PolkaVM implementation contract)
    core/                      # contract-registry-core — pure shared logic (slots, name validation, wire format, shim ↔ resolver protocol)
    proxy/                     # contract-proxy — the frozen per-name shim (stable address + storage; asks the resolver, then delegates)
    resolver/                  # contract-resolver — routing tables + policy for every shim (upgradeable, registry-owned)
    eip1967-proxy/             # contract-eip1967-proxy — stable address in front of the registry and the resolver
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
| `contract-registry` | `src/contract` | On-chain ContractRegistry implementation (Rust/PolkaVM) — also the per-name shim factory and the resolver's admin |
| `contract-registry-core` | `src/contract/core` | Pure shared logic — EIP-1967 slots, name validation, versioned-call wire format, shim ↔ resolver protocol |
| `contract-proxy` | `src/contract/proxy` | Per-name shim (frozen) — a contract name's stable address + storage; asks the resolver, then delegates |
| `contract-resolver` | `src/contract/resolver` | Resolver — routing tables + policy for every shim; one upgrade reaches every name |
| `contract-eip1967-proxy` | `src/contract/eip1967-proxy` | EIP-1967 proxy — the stable address in front of the registry and the resolver |
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
pnpm build:registry           # Build registry impl, EIP-1967 proxy, resolver and shim via src/lib/scripts/build-registry.sh (mainline cargo-pvm-contract)
pnpm build:template           # Build shared-counter template contracts
pnpm compile:cli              # build:ts + embed:templates + compile CLI to dist/cdm
pnpm compile:all              # Cross-compile (darwin-arm64, darwin-x64, linux-x64, linux-arm64)
pnpm install:cli              # compile:cli + copy to ~/.cdm/bin/cdm
pnpm embed:templates          # bun run src/lib/scripts/embed-templates.ts

# Deployment
pnpm deploy:registry -- --name local  # bun run src/lib/scripts/deploy-registry.ts

# Testing
pnpm test                     # vitest + test:macro + test:rust
pnpm test:e2e                 # end-to-end tests (requires a running local PPN: `npm install -g @parity/ppn && ppn start --ephemeral` — see src/lib/contracts/tests/e2e/harness.ts)
pnpm test:macro               # Compile cdm::import! consumer to PolkaVM
pnpm test:rust                # Host-side Rust unit tests

# Full gate
pnpm check                    # embed:templates + format:check + typecheck + build + test

# Formatting
pnpm format                   # Format all TS and Rust code
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

## Rust Contracts

Target: PolkaVM (`riscv64emac-unknown-none-polkavm`) via `.cargo/config.toml`. Requires `cargo-pvm-contract` for building. Cannot `cargo check --workspace` without the PolkaVM target toolchain — use `cargo pvm-contract build` instead.

The ContractRegistry stores name → semver-versioned history (version keys pack `major<<64|minor<<32|patch` into u128) and metadata URIs on-chain, and acts as a factory for per-name shims. It ships as four contracts on the mainline pvm-contract-sdk:

- `src/contract/src/main.rs` — the implementation: `publish(name, versionKey, target, metadataUri)` (strictly-increasing keys; first publish CREATE2-instantiates the name's shim with `salt = keccak256(name)` and the resolver address as constructor input), `setMinSupported`/`freezeContract` written to the resolver, queries, admin import, plus longevity controls: `setCode(address)` (UUPS-style upgrade — repoints the registry proxy, keeping address and state), `setProxyCodeHash(bytes32)` (shim blob for future first publishes), `setResolver(address)` (write-once) / `upgradeResolver(address)` (repoints the resolver proxy — one upgrade reaches every name), `freeze()`/`unfreeze()` (blocks all non-admin mutations with `ContractFrozen()`).
- `src/contract/proxy/src/main.rs` — `contract-proxy`, the per-name shim: owns a name's permanent address, storage, and balance, and holds no policy. Its only rule: forward every call to the resolver as `resolve(caller, value, data)` (read-only; the resolver address is pallet immutable data set by the constructor) and do what the `Resolution` says — kind 0 returns the payload, kind 1 delegate-calls `target` with `payload ++ data[strip..]`. Resolver reverts bubble unchanged; anything else is `MalformedResolution()`. The module doc is the protocol spec; the blob is frozen at `src/contract/proxy/artifacts/` and is the only part of the design that can never change.
- `src/contract/resolver/src/main.rs` — `contract-resolver`, behind an EIP-1967 proxy with the registry as admin: the routing tables (`routing: shim → latest/floor/frozen`, `implementations: shim → key → implementation`) and the policy. Plain calldata → latest implementation, `[MAGIC][u128 key]` → that exact version (below the owner's floor → `UnsupportedVersion()`), `[MAGIC][0][selector]` → the CDM meta plane: queries (`implOf`, `latest`, `minSupported`, `frozen`, `admin`) plus `callCode`, honored only when the shim's caller is the registry (the initializations primitive, live while frozen). Mutations (`publish`, `setMinSupported`, `setFrozen`, `setCode`) are registry-only. Wire format + protocol constants live in `contract-registry-core::versioning` and are mirrored (and drift-tested) in `src/lib/contracts/src/proxy.ts`.
- `src/contract/eip1967-proxy/src/main.rs` — a method-less EIP-1967 proxy that owns a stable address and tail-delegate-calls everything to the implementation; one instance fronts the registry, one the resolver. Deployed through the CREATE3 factory with `(implementation, admin)` constructor args (`src/lib/contracts/src/registry-deploy.ts`); the registry proxy address is the registry address consumers use.
- `src/contract/core/` — `contract-registry-core`, host-independent shared logic (EIP-1967 slot constants, contract-name validation, versioned-call wire format, the `resolve` request/response layout) unit-tested with plain `cargo test`.

Admin/upgrade state (admin, implementation, frozen) lives at fixed EIP-1967-style slots so implementations can reshape ordinary storage freely — the shim has no storage of its own, so user contracts behind it keep plain auto-numbered slots and need no slot attributes at all. Contract unit tests run on the host via `MockHost` and are included in `pnpm test:rust`. The dispatch-level tests inline in `src/contract/src/main.rs` lock the `getAddress(string)` selector + 64-byte return layout that `pvm-cdm-macros` hardcodes, and the registry→resolver/shim calldata bytes — do not change those wire formats without updating every side.

## Testing

Tests use `vitest`. Run from project root:
- `detection.test.ts` — Contract detection, dependency graph, toposort (at `src/lib/contracts/tests/`)
- `commands.test.ts` — CLI help output, template scaffolding (at `src/apps/cli/tests/`)

## Path Conventions

- Template files live at `src/templates/`, embedded at build time into `src/apps/cli/src/generated/`
- Stubs (e.g., react-devtools-core) at `src/stubs/`
- No local papi codegen: typed chain APIs/descriptors come prebuilt from `@parity/product-sdk-descriptors` (e.g. `@parity/product-sdk-descriptors/paseo-asset-hub`), version-pinned in the `pnpm-workspace.yaml` catalog
- Rust build artifacts at `target/` (project root, shared by Cargo workspace)
- Local imports use no `.js` extensions (moduleResolution: "bundler"); exception: `@noble/hashes/blake2.js`
- From `src/apps/cli/tests/`: `../../../..` = project root, `../../..` = `src/`
