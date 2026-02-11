# Contract Dependency Manager (CDM)

A CLI tool for managing PVM smart contract dependencies on Polkadot. CDM automates contract deployment ordering, cross-contract address resolution, and TypeScript type generation.

## Quick Install

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash
```

## Quick Start

```bash
# Start a local network (Product Preview Net)
curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash
cd ppn && make start

# Scaffold a new project
cdm template my-project
cd my-project

# Build contracts
cdm build

# Deploy to local Asset Hub (bootstrap mode)
cdm deploy --bootstrap ws://127.0.0.1:10020

# Add a contract library to your TypeScript project
cdm add @polkadot/reputation --registry 0x...
```

## Local Network (PPN)

CDM requires a running Polkadot chain with the Revive pallet for contract deployment. For local development, use **Product Preview Net (PPN)**, which spins up both a Bulletin and Asset Hub parachain locally.

```bash
# Install and start PPN
curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash
cd ppn && make start
```

Once running, Asset Hub is available at `ws://127.0.0.1:10020`. This is the default URL used by CDM scripts for local development.

## How It Works

CDM solves the "chicken-and-egg" problem of smart contract deployment. When contracts depend on each other, they need to know each other's addresses - but addresses aren't known until deployment.

CDM uses an on-chain **ContractRegistry** to resolve addresses at runtime:

1. Contracts declare dependencies via `#[pvm::contract(cdm = "@scope/name")]`
2. CDM scans your workspace, builds a dependency graph, and topologically sorts it
3. Contracts are deployed in order, each registered in the ContractRegistry
4. At runtime, `cdm_reference()` looks up the latest address from the registry

## Commands

### `cdm build`
Build all contracts with the ContractRegistry address baked in.

```bash
CONTRACTS_REGISTRY_ADDR=0x... cdm build
cdm build --contracts counter counter_writer    # Build specific contracts
cdm build --root /path/to/workspace             # Custom workspace root
```

### `cdm deploy <url>`
Deploy and register all contracts to a chain.

```bash
# Bootstrap: deploy ContractRegistry + all contracts from scratch (local PPN)
cdm deploy --bootstrap ws://127.0.0.1:10020

# Standard: deploy CDM contracts (registry already exists)
CONTRACTS_REGISTRY_ADDR=0x... cdm deploy ws://127.0.0.1:10020

# Options
cdm deploy --signer Bob ws://127.0.0.1:10020     # Use different signer
cdm deploy --dry-run ws://127.0.0.1:10020         # Preview deployment plan
cdm deploy --skip-build ws://127.0.0.1:10020      # Use pre-built artifacts
```

### `cdm add <library>`
Add a CDM contract library for use with polkadot-api. Queries the on-chain registry for the contract's ABI metadata and installs it locally.

```bash
cdm add @polkadot/reputation --registry 0x...
cdm add @polkadot/disputes --url wss://asset-hub.polkadot.io
```

### `cdm template [dir]`
Scaffold a complete example project with 3 contracts demonstrating cross-contract CDM dependencies.

```bash
cdm template my-project        # Create in ./my-project
cdm template                   # Create in current directory
```

## Writing CDM Contracts

Annotate your contract with a CDM package name:

```rust
#[pvm::contract(cdm = "@yourscope/mycontract")]
mod mycontract {
    #[pvm::constructor]
    pub fn new() -> Result<(), Error> { Ok(()) }

    #[pvm::method]
    pub fn do_something() -> u32 { 42 }
}
```

To call another CDM contract:

```rust
// Add the contract as a Cargo dependency
// Then use cdm_reference() for runtime address lookup
let other = other_contract::cdm_reference();
other.do_something().expect("call failed");
```

## Example: Shared Counter

The included shared-counter template demonstrates a 3-contract system:

- **counter** - Stores a shared count value
- **counter-writer** - Calls counter to increment (depends on counter via CDM)
- **counter-reader** - Queries counter for the current value (depends on counter via CDM)

```
cdm template my-counter
cd my-counter
cdm deploy --bootstrap ws://127.0.0.1:10020
cd ts && bun install && bun run src/validate.ts
```

## Development

```bash
git clone https://github.com/paritytech/contract-dependency-manager.git
cd contract-dependency-manager
./scripts/setup.sh

# Run in dev mode
bun run src/cli.ts --help

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
  cli.ts              Entry point (Commander.js)
  commands/
    build.ts          Build contracts with registry address
    deploy.ts         Deploy + register contracts on-chain
    add.ts            Add contract types via papi
    template.ts       Scaffold example project
  lib/
    detection.ts      Workspace scanning, dependency graph, topological sort
    deployer.ts       On-chain deployment + ABI encoding
    connection.ts     WebSocket / Smoldot chain connections
    signer.ts         sr25519 key derivation
contracts/
  registry/           ContractRegistry on-chain contract (Rust/PolkaVM)
templates/
  shared-counter/     Example project template
```

## License

Apache-2.0
