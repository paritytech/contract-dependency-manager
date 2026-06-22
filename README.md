> [!WARNING]
> The following is a prototype, reference implementation, and proof-of-concept. This open source code is provided for research, experimentation, and developer education only. This code has not been audited, is actively experimental, and may contain bugs, vulnerabilities, or incomplete features. Use at your own risk.

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

Before deploying a template, change every `[package.metadata.cdm] package = "@example/..."` namespace in the contracts' `Cargo.toml` files to one you own, such as `@myteam/counter`. Package names are global per registry target.

## CDM And Product SDK

Use CDM for contract lifecycle and dependency resolution:

- Build PVM contracts.
- Deploy contracts to Asset Hub.
- Publish ABI/readme metadata to Bulletin.
- Register `@org/name -> address + metadata` in the ContractRegistry.
- Install published contracts into `cdm.json`, `.cdm/contracts.d.ts`, and generated Solidity import files.

Use product-sdk in apps and frontends:

- Do not import `@parity/cdm-codegen` in frontend/runtime app code.
- Use `@parity/product-sdk-contracts` and `ContractManager` to resolve contracts from `cdm.json`.
- Use `@parity/product-sdk-signer` for Product Account / Triangle host signing.
- Use `@parity/product-sdk-chain-client` for host chain connections.
- Use `@parity/product-sdk-tx` when batching `.prepare()` calls with other Asset Hub transactions.

`cdm install` generates type augmentation for `@parity/product-sdk-contracts`, so `ContractManager.getContract("@org/name")` is typed after `.cdm/contracts.d.ts` is included by TypeScript. Solidity projects also get address-backed interfaces under `.cdm/solidity/`.

## Writing CDM Contracts

Declare each Rust contract's CDM package name in `Cargo.toml`:

```toml
[package.metadata.cdm]
package = "@yourorg/mycontract"
```

Then define the contract with the `pvm_contract_sdk` macros:

```rust
#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod mycontract {
    pub struct MyContract;

    impl MyContract {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        #[pvm_contract_sdk::method]
        pub fn do_something(&self) -> u32 { 42 }
    }
}
```

To call another CDM contract from Rust:

```rust
cdm::import!("@someorg/other-contract");

let other = other_contract::OtherContract::cdm_lookup();
other.do_something().call(self).expect("OtherCallFailed");
```

For workspace-local packages, `cdm::import!` resolves the ABI through Cargo metadata when the provider crate declares the matching `[package.metadata.cdm] package`. For external packages, run `cdm i -n paseo @someorg/other-contract` first; the macro falls back to the flat `cdm.json` snapshot and materializes any ABI file it needs under the project-local `.cdm/` directory.

Solidity contracts use NatSpec for their own CDM package name:

```solidity
/// @custom:cdm @yourorg/mycontract
contract MyContract {}
```

To call an installed CDM contract from Solidity, import the generated interface:

```solidity
import ".cdm/solidity/someorg/other-contract.sol";

contract Caller {
    function callOther() external returns (uint256) {
        return SomeorgOtherContract.ref().doSomething();
    }
}
```

The generated file contains an interface plus a small library with `ADDRESS`, `ref()`, and `cdm()`. Running `cdm i` updates that generated file from the registry, so contract source does not need an address edit.

## Using Contracts From A Triangle App

Install published contract ABIs:

```bash
cdm i -n paseo @yourorg/counter @yourorg/counter-writer
```

This updates `cdm.json`, stores ABI/metadata artifacts under project-local `.cdm/contracts/`, writes `.cdm/contracts.d.ts`, and generates Solidity imports under `.cdm/solidity/`. Keep `.cdm/**/*` in `tsconfig.json` so product-sdk contract handles are typed.

Install the product-sdk app/runtime packages:

```bash
pnpm add @parity/product-sdk-chain-client@^0.5.2 \
  @parity/product-sdk-contracts@^0.6.2 \
  @parity/product-sdk-descriptors@^0.5.1 \
  @parity/product-sdk-signer@^0.5.0 \
  @parity/product-sdk-tx@^0.2.6 \
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

## Solidity Templates

CDM includes first-pass Solidity scaffolds for the two supported Solidity toolchains:

```bash
cdm template hardhat-counter
cdm template foundry-counter
```

`hardhat-counter` uses `@parity/hardhat-polkadot` and compiles with `pnpm build`.
`foundry-counter` uses the Polkadot Foundry fork and compiles with `forge build --resolc`.

These templates are compile-ready starter projects and can be built, deployed, published, registered, installed, and consumed through CDM.

## Commands

### `cdm build`

Build all contracts with the selected ContractRegistry address baked in.

```bash
cdm build
cdm build --contracts counter counter_writer
cdm build -n paseo
cdm build --root /path/to/workspace
```

### `cdm deploy -n <chain>`

Build, deploy, publish metadata, and register all workspace contracts.

```bash
cdm deploy -n paseo
cdm deploy -n paseo --suri //Bob
cdm deploy --registry-address 0x... --assethub-url wss://... --bulletin-url wss://...
```

Supported deploy presets are `paseo` and `local`. Use explicit URLs with `--assethub-url`, `--bulletin-url`, and `--registry-address` for custom networks. The `paseo` preset points at Paseo v2.

### `cdm install -n <chain> <library>`

Install published contracts for Rust imports, Solidity imports, and product-sdk TypeScript usage.

```bash
cdm i -n paseo @polkadot/contexts @polkadot/profiles
cdm i -n paseo @yourorg/package:3
```

`cdm install` queries the registry, fetches metadata from the configured Bulletin IPFS gateway, updates the flat `cdm.json`, installs ABI/metadata artifacts under project-local `.cdm/contracts/`, regenerates `.cdm/contracts.d.ts`, and writes Solidity interfaces under `.cdm/solidity/`.

### `cdm test`

Deploy contracts to a local network, install their ABIs into `cdm.json`, and run vitest. The happy path is a single command from any CDM project:

```bash
cdm test                  # deploy + install + run chain-dependent tests
cdm test --skip-deploy    # reuse current on-chain state
cdm test --skip-install   # reuse cached cdm.json
cdm test --skip-vitest    # only set up the chain, don't run tests
```

By default only **chain-dependent** vitest tests run — those grouped under a vitest project named `"contract"` in your `vitest.config.ts`. Unit/component suites that don't talk to a chain are skipped, since they don't need the deploy+install cycle and run faster via `pnpm test`.

```bash
cdm test --project all      # run every vitest project (unit + contract + ...)
cdm test --project e2e      # pick a different project by name
```

Recommended `vitest.config.ts` shape for opting in:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit",     include: ["src/**/*.test.{ts,tsx}"] } },
      { test: { name: "contract", include: ["tests/contract/**/*.test.ts"] } },
    ],
  },
});
```

If your project doesn't use vitest's `projects` feature, pass `--project all` or `--project <your-project-name>`.

`cdm test` auto-starts PPN (the local Product Preview Network) if it's not already up; use `--no-auto-network` to fail instead of starting it.

### `cdm template [name]`

Scaffold an example project into `./<template-name>` by default. Pass a target directory to override it; use `.` to scaffold into the current directory.

```bash
cdm template shared-counter      # writes ./shared-counter
cdm template instagram           # writes ./instagram
cdm template hardhat-counter     # writes ./hardhat-counter
cdm template foundry-counter     # writes ./foundry-counter
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
make test                # unit tests only (fast)
pnpm test:e2e            # end-to-end: spawns revive-dev-node, deploys
                         # the registry, exercises every method.
                         # Requires `revive-dev-node` and `bun` on $PATH:
                         #   cargo install --git https://github.com/paritytech/polkadot-sdk --bin revive-dev-node
                         #   curl -fsSL https://bun.sh/install | bash

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
    contracts/            @parity/cdm-builder: detection, deploy, publish, registry, install helpers
    env/                  @parity/cdm-env: chain connections, signers, presets
    utils/                @parity/cdm-utils: shared constants and utilities
    scripts/              build/deploy helper scripts
    cdm/                  Rust macro + TypeScript compatibility package
  contract/               ContractRegistry (Rust/PolkaVM)
  templates/              Project scaffolding templates
```

## License

Apache-2.0
