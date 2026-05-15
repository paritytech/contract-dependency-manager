# Contract Dependency Manager (CDM)

CDM is the deploy, registry, and dependency tool for PVM smart contracts on Polkadot. It builds contracts in dependency order, deploys them to Asset Hub, publishes metadata to Bulletin, registers package names in the on-chain registry, and installs typed ABIs for downstream projects.

Browse published contracts at [contracts.dot.li](https://contracts.dot.li/#/).

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash
```

This installs the `cdm` binary, the Rust nightly toolchain with `rust-src`, and `cargo-pvm-contract`.

## Quick Start

```bash
# Scaffold a new workspace
cdm template shared-counter

# Generate a deploy account and map it for pallet-revive
cdm init -n paseo
cdm account map -n paseo

# Build, deploy, publish metadata, and register all workspace contracts
cdm deploy -n paseo
```

Before deploying a template, change every `#[pvm::contract(cdm = "@example/...")]` namespace to one you own, such as `@myteam/counter`. Package names are global per registry target.

## CDM And Product SDK

Use CDM for contract lifecycle and dependency resolution:

- Build PVM contracts.
- Deploy contracts to Asset Hub.
- Publish ABI/readme metadata to Bulletin.
- Register `@org/name -> address + metadata` in the ContractRegistry.
- Install published contracts into `cdm.json` and `.cdm/contracts.d.ts`.

Use product-sdk in apps and frontends:

- Do not import `@dotdm/cdm` in frontend/runtime app code.
- Use `@parity/product-sdk-contracts` and `ContractManager` to resolve contracts from `cdm.json`.
- Use `@parity/product-sdk-signer` for Product Account / Triangle host signing.
- Use `@parity/product-sdk-chain-client` for host chain connections.
- Use `@parity/product-sdk-tx` when batching `.prepare()` calls with other Asset Hub transactions.

`cdm install` generates type augmentation for `@parity/product-sdk-contracts`, so `ContractManager.getContract("@org/name")` is typed after `.cdm/contracts.d.ts` is included by TypeScript.

## Writing CDM Contracts

Annotate each contract with a CDM package name:

```rust
#[pvm::contract(cdm = "@yourorg/mycontract")]
mod mycontract {
    #[pvm::constructor]
    pub fn new() -> Result<(), Error> { Ok(()) }

    #[pvm::method]
    pub fn do_something() -> u32 { 42 }
}
```

To call another CDM contract from Rust:

```rust
cdm::import!("@someorg/other-contract");

let other = other_contract::cdm_reference();
if let Err(_) = other.do_something() {
    common::revert(b"OtherCallFailed");
}
```

For external packages, run `cdm i -n paseo @someorg/other-contract` first. The import macro reads `cdm.json`, resolves the installed ABI in `~/.cdm`, and generates the same typed reference shape as a same-workspace Cargo dependency.

## Using Contracts From A Triangle App

Install published contract ABIs:

```bash
cdm i -n paseo @yourorg/counter @yourorg/counter-writer
```

This updates `cdm.json`, stores ABIs under `~/.cdm`, and writes `.cdm/contracts.d.ts`. Keep `.cdm/**/*` in `tsconfig.json` so product-sdk contract handles are typed.

Install the product-sdk app/runtime packages:

```bash
pnpm add @parity/product-sdk-chain-client@^0.4.1 \
  @parity/product-sdk-contracts@^0.5.0 \
  @parity/product-sdk-descriptors@^0.4.0 \
  @parity/product-sdk-signer@^0.2.4 \
  @parity/product-sdk-tx@^0.2.3 \
  polkadot-api@^2.1.2
```

In frontend code, use product-sdk:

```ts
import { getChainAPI } from "@parity/product-sdk-chain-client";
import {
  ContractManager,
  ensureContractAccountMapped,
  type CdmJson,
} from "@parity/product-sdk-contracts";
import { paseo_asset_hub } from "@parity/product-sdk-descriptors/paseo-asset-hub";
import { SignerManager } from "@parity/product-sdk-signer";
import cdmJson from "./cdm.json";

const DOT_NS_IDENTIFIER = "my-app.dot";

const signerManager = new SignerManager({ dappName: "my-app" });
await signerManager.connect();

const productAccount = await signerManager.getProductAccount(DOT_NS_IDENTIFIER);
if (!productAccount.ok) throw productAccount.error;

const chain = await getChainAPI("paseo");
const contracts = ContractManager.fromClient(
  cdmJson as CdmJson,
  chain.raw.assetHub,
  paseo_asset_hub,
);

await ensureContractAccountMapped(
  contracts.getRuntime(),
  productAccount.value.address,
  productAccount.value.getSigner(),
);

contracts.setDefaults({
  origin: productAccount.value.address,
  signer: productAccount.value.getSigner(),
});

const counter = contracts.getContract("@yourorg/counter");

const { value } = await counter.getCount.query();
await counter.increment.tx();
```

Every contract method exposes:

- `.query(...args, opts?)` for read-only dry-runs.
- `.tx(...args, opts?)` for signed contract calls.
- `.prepare(...args, opts?)` for batch-ready calls.

Batch contract calls with other Asset Hub transactions:

```ts
import { batchSubmitAndWatch } from "@parity/product-sdk-tx";

const a = counter.increment.prepare();
const counterWriter = contracts.getContract("@yourorg/counter-writer");
const b = counterWriter.writeIncrement.prepare();

await batchSubmitAndWatch([a, b], chain.raw.assetHub, productAccount.value.getSigner());
```

## Example: Shared Counter

The shared-counter template demonstrates a three-contract dependency graph:

- `counter` stores a shared count value.
- `counter-writer` calls `counter.increment()` through a CDM reference.
- `counter-reader` queries `counter.get_count()` through a CDM reference.

```bash
cdm template shared-counter
cdm deploy -n paseo
cdm i -n paseo @yourorg/counter @yourorg/counter-writer @yourorg/counter-reader
```

## Commands

### `cdm build`

Build all contracts with the selected ContractRegistry address baked in.

```bash
cdm build
cdm build --contracts counter counter_writer
cdm build -n preview-net
cdm build --root /path/to/workspace
```

### `cdm deploy -n <chain>`

Build, deploy, publish metadata, and register all workspace contracts.

```bash
cdm deploy -n paseo
cdm deploy -n preview-net
cdm deploy -n paseo --suri //Bob
cdm deploy --registry-address 0x... --assethub-url wss://... --bulletin-url wss://...
```

Supported deploy presets are `paseo`, `preview-net`, and `local`. The `paseo` preset points at Paseo v2.

### `cdm install -n <chain> <library>`

Install published contracts for Rust imports and product-sdk TypeScript usage.

```bash
cdm i -n paseo @polkadot/contexts @polkadot/profiles
cdm i -n preview-net @yourorg/package
cdm i -n paseo @yourorg/package:3
```

`cdm install` queries the registry, fetches metadata from the configured Bulletin IPFS gateway, updates `cdm.json`, installs ABIs under `~/.cdm`, and regenerates `.cdm/contracts.d.ts`.

### `cdm template [name]`

Scaffold an example project into `./<template-name>` by default. Pass a target directory to override it; use `.` to scaffold into the current directory.

```bash
cdm template shared-counter      # writes ./shared-counter
cdm template instagram           # writes ./instagram
cdm template instagram .         # writes current directory
cdm template instagram ./apps/ig # creates ./apps/ig recursively
cd instagram && cdm template .   # infers the instagram template from cwd
```

The Instagram template is the current browser app example. It uses product-sdk host flows, Product Account signing, Bulletin uploads, and `ContractManager` resolution from `cdm.json`.

## Development

```bash
git clone https://github.com/paritytech/contract-dependency-manager.git
cd contract-dependency-manager
make setup

# Run the CLI in dev mode
bun run src/apps/cli/src/cli.ts --help

# Run the frontend; rebuilds local workspace deps first
make frontend

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
    frontend/             Contract Hub web dashboard (React, Vite)
  lib/
    contracts/            @dotdm/contracts: detection, deploy, publish, registry, install helpers
    env/                  @dotdm/env: chain connections, signers, presets
    utils/                @dotdm/utils: shared constants and utilities
    scripts/              build/deploy helper scripts
    cdm/                  Rust macro + TypeScript compatibility package
  contract/               ContractRegistry (Rust/PolkaVM)
  templates/              Project scaffolding templates
```

## License

Apache-2.0
