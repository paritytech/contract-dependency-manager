# Contract Dependency Manager (CDM)

A CLI tool for managing PVM smart contract dependencies on Polkadot. CDM automates contract deployment ordering, cross-contract address resolution, and TypeScript type generation.

Browse published contracts at [contracts.paseo.li](https://contracts.paseo.li/#/).

## Table of Contents

- [Install CLI](#install)
- [Quick Start](#quick-start)
- [Writing CDM Contracts](#writing-cdm-contracts)
- [Using CDM Contracts from TypeScript](#using-contracts-from-typescript)
- [Example: Shared Counter](#example-shared-counter)
- [Commands](#commands)

## Install

```bash
curl -fsSL https://contracts.paseo.li/install | bash
```

This installs the `cdm` binary, the Rust nightly toolchain with `rust-src`, and `cargo-pvm-contract`.

## Quick Start

```bash
# Scaffold a new project (current workspace directory)
cdm template shared-counter

# Initialize, fund & map dev account for deploying to paseo
cdm init
cdm account map -n paseo

# Deploy all workspace contracts
cdm deploy -n paseo
```

> **Important:** Before deploying, open each contract's `lib.rs` and change the org name from `"example"` to your own unique org name (e.g. `"myteam"`). Contract names are scoped by org, so deploying with `"example"` will conflict with other users.

## Writing CDM Contracts

Annotate your contract with a CDM package name:

```rust
#[pvm::contract(cdm = "@yourorg/mycontract")]
mod mycontract {
    #[pvm::constructor]
    pub fn new() -> Result<(), Error> { Ok(()) }

    #[pvm::method]
    pub fn do_something() -> u32 { 42 }
}
```

To call another CDM contract:

```rust
cdm::import!("@someorg/other_contract")

// Add the contract as a cdm dependency using `cdm install`
// Then use cdm_reference() for runtime address lookup
let other = other_contract::cdm_reference();
other.do_something().expect("call failed");
```

## Using Contracts from TypeScript

After deploying contracts, you can interact with them from TypeScript using `@dotdm/cdm`.

### 1. Install contract ABIs

```bash
cdm install -n paseo @yourorg/counter @yourorg/counter-writer @yourorg/counter-reader
```

This fetches contract ABIs from the on-chain registry, saves them to `cdm.json`, and generates TypeScript types in `.cdm/cdm.d.ts`. You get full autocomplete and type safety for every contract method.

### 2. Create a CDM instance and call contracts

```typescript
import { createCdm } from "@dotdm/cdm";

// Reads cdm.json from cwd, connects to the chain automatically
const cdm = createCdm({ defaultSigner: signer });

// Get typed contract handles
const counter = cdm.getContract("@yourorg/counter");
const counterWriter = cdm.getContract("@yourorg/counter-writer");

// Query (read-only, no transaction)
const count = await counter.getCount.query();
console.log(count); // { success: true, value: 0 }

// Send a transaction (state-changing)
await counterWriter.writeIncrement.tx();

// Clean up WebSocket connection
cdm.destroy();
```

Every contract method exposes `.query()` for dry-run reads and `.tx()` for signed transactions. Arguments are positional:

```typescript
await counterWriter.writeIncrementN.tx(5);
```

### 3. Custom signer

By default `createCdm()` uses the Alice dev account. To use a custom signer, pass it to `.tx()`:

```typescript
await counter.increment.tx({ signer: myPolkadotSigner });
```

## Example: Shared Counter

The included shared-counter template demonstrates a 3-contract system:

- **counter** - Stores a shared count value
- **counter-writer** - Calls counter to increment (depends on counter via CDM)
- **counter-reader** - Queries counter for the current value (depends on counter via CDM)

```
cdm template shared-counter
cdm deploy deploy -n paseo
cdm install @<yourorg>/counter @<yourorg>/counter-writer @<yourorg>/counter-reader

bun run src/index.ts
```

## Commands

### `cdm build`

Build all contracts with the ContractRegistry address baked in.

```bash
cdm build --contracts counter counter_writer    # Build specific contracts
cdm build --root /path/to/workspace             # Custom workspace root
```

### `cdm deploy -n <chain>`

Build & deploy/register all contracts

```bash
cdm deploy -n paseo

# Options
cdm deploy -n paseo --signer Bob  # Use different signer
cdm deploy -n paseo --dry-run     # Preview deployment plan
```

### `cdm install -n <chain> <library>`

Add a CDM contract library for use with `@dotdm/cdm` or  the polkadot-api. Queries the on-chain registry for the contract's ABI metadata and installs it locally.

```bash
cdm i -n paseo @polkadot/reputation @polkadot/disputes
```

### `cdm template [name]`

Scaffold a complete example project with 3 contracts demonstrating cross-contract CDM dependencies.

```bash
cdm template shared-counter
```

## Development

```bash
git clone https://github.com/paritytech/contract-dependency-manager.git
cd contract-dependency-manager
make setup

# Run in dev mode
bun run src/apps/cli/src/cli.ts --help

# Run tests
make test

# Build native binary
make compile

# Cross-compile for all platforms
make compile-all
```

## Architecture

```
src/
  apps/
    cli/                  CLI tool (Commander.js, Bun runtime)
      src/
        cli.ts            Entry point
        commands/          build, deploy, install, template
        lib/              Pipeline orchestration, Ink UI
    frontend/             Web dashboard (React 19, Vite)
  lib/
    contracts/            @dotdm/contracts — Detection, deployer, publisher, registry, builder
    env/                  @dotdm/env — Chain connections, signer, chain presets
    utils/                @dotdm/utils — Shared constants, utilities
    scripts/              @dotdm/scripts — embed-templates, deploy-registry
    cdm/                  Stub packages (Rust + TypeScript)
  contract/               ContractRegistry (Rust/PolkaVM)
  templates/              Project scaffolding templates
```

## License

Apache-2.0
