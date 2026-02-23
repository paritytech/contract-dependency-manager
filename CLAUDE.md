# Contract Dependency Manager (CDM)

CLI and web tooling for managing PVM smart contract dependencies on Polkadot. Automates contract deployment ordering, cross-contract address resolution, and TypeScript type generation.

## Workflow Rules

- **Always act as team leader.** The primary agent the user is talking to MUST act as a team leader and delegate work to sub-agents for almost everything.
- **Always use team mode.** You MUST always run agents in team mode (using `TeamCreate` + `Task` with `team_name`) so the user can properly watch their work. Never use standalone agents outside of a team. This applies to ALL agent usage — no exceptions.
- **Always format when done.** After finishing code changes, run `pnpm format` to ensure consistent formatting before presenting results to the user.

## Monorepo Structure

pnpm workspaces + Turbo. Bun for CLI runtime/compilation, pnpm for package management.

```
Cargo.toml                     # Rust workspace root
package.json                   # pnpm workspace root
pnpm-workspace.yaml            # Workspace packages + version catalog
turbo.json                     # Task pipeline
tsconfig.json                  # Base TS config (no outDir/rootDir/jsx)
Makefile                       # Top-level dev commands
src/
  apps/
    cli/                       # @dotdm/cli — Commander.js CLI (bun runtime)
      src/cli.ts               #   Entry point
      src/commands/             #   build, deploy, install, template
      src/lib/                  #   pipeline.ts, ui.ts, components/DeployTable.tsx
      src/generated/            #   Auto-generated template embeds (gitignored)
      tests/                    #   bun test (detection, commands, pipeline, e2e)
    frontend/                  # @dotdm/frontend — React 19 SPA (Vite)
  lib/
    utils/                     # @dotdm/utils — Shared constants/types
      src/constants.ts         #   ALL constants (ALICE_SS58, GAS_LIMIT, STORAGE_DEPOSIT_LIMIT, CONTRACTS_REGISTRY_CRATE, DEFAULT_NODE_URL)
      src/utils.ts             #   stringifyBigInt
    contracts/                 # @dotdm/contracts — Contract tooling
      src/detection.ts         #   Workspace scanning, dependency graph, topological sort
      src/deployer.ts          #   Contract deployment via Revive pallet
      src/publisher.ts         #   Metadata publishing to Bulletin chain
      src/registry.ts          #   ContractRegistry ink contract interaction
      src/builder.ts           #   Cargo build wrapper (cargo pvm-contract build)
      src/cid.ts               #   CID computation
      src/store.ts             #   ~/.cdm/ directory persistence (saveContract, getCdmRoot, getContractDir)
    env/                       # @dotdm/env — Chain environment
      src/connection.ts        #   WebSocket and Smoldot chain connections
      src/signer.ts            #   sr25519 key derivation (dev accounts)
      src/known_chains.ts      #   Chain presets (polkadot, paseo, preview-net, local)
    scripts/                   # @dotdm/scripts — Standalone bun scripts
      embed-templates.ts       #   Generate src/apps/cli/src/generated/templates.ts
      deploy-registry.ts       #   Deploy registry on-chain
    cdm/
      rust/                    # cdm crate (stub)
      typescript/              # @dotdm/cdm package (stub)
  contract/                    # contract-registry Rust crate (PolkaVM)
  templates/                   # Scaffolding templates (shared-counter)
  stubs/                       # Stub packages (react-devtools-core)
```

## Workspace Packages

| Package | Path | Purpose |
|---------|------|---------|
| `@dotdm/cli` | `src/apps/cli` | CLI tool — runs via bun, compiles to standalone binary |
| `@dotdm/frontend` | `src/apps/frontend` | Web dashboard — Vite + React |
| `@dotdm/utils` | `src/lib/utils` | Shared constants and utilities |
| `@dotdm/contracts` | `src/lib/contracts` | Contract deployment, detection, building, publishing, registry, CID, store |
| `@dotdm/env` | `src/lib/env` | Chain connections, signer, chain presets |
| `@dotdm/scripts` | `src/lib/scripts` | Standalone bun scripts (embed-templates, deploy-registry) |
| `@dotdm/cdm` | `src/lib/cdm/typescript` | Stub TS library |
| `contract-registry` | `src/contract` | On-chain ContractRegistry (Rust/PolkaVM) |
| `cdm` | `src/lib/cdm/rust` | Stub Rust crate |

## Key Commands

```bash
# Setup
make setup                    # Install ppn-proxy + pnpm install + build templates

# Development
make dev                      # Run CLI in dev mode (bun)
make frontend                 # pnpm --filter @dotdm/frontend dev
bun run src/apps/cli/src/cli.ts  # Run CLI directly

# Building
make compile                  # bun build --compile CLI to ~/.cdm/bin/cdm
make compile-all              # Cross-compile (darwin-arm64, darwin-x64, linux-x64)
make build-registry           # cargo pvm-contract build for ContractRegistry
make build-template           # Build shared-counter template contracts
make embed-templates          # bun run src/lib/scripts/embed-templates.ts

# Deployment
make deploy-registry CHAIN=local  # bun run src/lib/scripts/deploy-registry.ts

# Testing
make test                     # bun test (detection, commands, e2e)
bun test src/apps/cli/tests/  # Run all CLI tests

# Package management
pnpm install                  # Install all workspace deps
pnpm --filter @dotdm/frontend build  # Build specific package
pnpm exec papi                # Run polkadot-api codegen
```

## Version Management

All dependency versions are centralized in `pnpm-workspace.yaml` via the `catalog:` protocol. Workspace packages reference each other with `workspace:*`. Never hardcode versions in individual package.json files for catalog-managed packages.

## CLI Architecture

Entry: `src/apps/cli/src/cli.ts` (Commander.js)

**Commands**: `build`, `deploy`, `install`, `template`

**CLI lib modules** (`src/apps/cli/src/lib/`):
- `pipeline.ts` — CLI-specific build/deploy/register orchestration with layered execution
- `ui.ts` — Ink terminal UI rendering
- `components/DeployTable.tsx` — Terminal deploy table component

**Shared imports**: CLI imports from `@dotdm/contracts` (detection, deployer, publisher, registry, builder, cid, store), `@dotdm/env` (connection, signer, KNOWN_CHAINS, getChainPreset), and `@dotdm/utils` (all constants, stringifyBigInt). All constants (`ALICE_SS58`, `GAS_LIMIT`, `STORAGE_DEPOSIT_LIMIT`, `CONTRACTS_REGISTRY_CRATE`, `DEFAULT_NODE_URL`) live in `@dotdm/utils`.

**Install command**: `cdm install` saves contract data (ABI, metadata, address) to `~/.cdm/<chain>/contracts/<name>/<version>/`.

## Frontend Architecture

React 19 + Vite + React Router DOM. Uses `@dotdm/env` for chain presets and `@dotdm/utils` for constants.

- `NetworkContext.tsx` — Chain connection management, imports `KNOWN_CHAINS`/`ChainPreset` from `@dotdm/env`
- `useRegistry.ts` — On-chain contract queries + IPFS metadata fetching (two-phase loading)
- DOMPurify + marked for XSS-safe markdown rendering

## Rust Contracts

Target: PolkaVM (`riscv64emac-unknown-none-polkavm`) via `.cargo/config.toml`. Requires `cargo-pvm-contract` for building. Cannot `cargo check --workspace` without the PolkaVM target toolchain — use `cargo pvm-contract build` instead.

The ContractRegistry (`src/contract/src/lib.rs`) stores contract name→version→address mappings and metadata URIs on-chain.

## Testing

Tests use `bun:test`. Run from project root:
- `detection.test.ts` — Contract detection, dependency graph, toposort (uses `src/templates/shared-counter`)
- `commands.test.ts` — CLI help output, template scaffolding
- `pipeline.test.ts` — Layered deployment ordering (note: some tests fail due to TEMPORARY sequential patch in `toposortLayers`)
- `e2e.test.ts` — Full bootstrap deploy (requires running local chain via `ppn`)

## Path Conventions

- Template files live at `src/templates/`, embedded at build time into `src/apps/cli/src/generated/`
- Stubs (e.g., react-devtools-core) at `src/stubs/`
- Polkadot API descriptors at `.papi/descriptors/` (gitignored codegen)
- Rust build artifacts at `target/` (project root, shared by Cargo workspace)
- Local imports use no `.js` extensions (moduleResolution: "bundler"); exception: `@noble/hashes/blake2.js`
- From `src/apps/cli/tests/`: `../../../..` = project root, `../../..` = `src/`
