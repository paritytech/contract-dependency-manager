# Shared Counter Example

This template demonstrates **cross-contract dependency management** using CDM (Contract Dependency Manager). Three contracts collaborate through CDM references: a base counter contract holds shared state, while separate reader and writer contracts interact with it.

## Contracts

### `counter` (`@example/counter`)
The base contract that owns the shared counter state. Exposes `increment()` and `get_count()` methods.

### `counter-writer` (`@example/counter-writer`)
Depends on `counter` via CDM. Calls `counter.increment()` to modify the shared state. Also provides `write_increment_n(n)` to increment multiple times in a single call.

### `counter-reader` (`@example/counter-reader`)
Depends on `counter` via CDM. Calls `counter.get_count()` to read the shared state without modifying it.

## How It Works

The `counter-writer` and `counter-reader` contracts declare a CDM dependency on the `counter` contract. At deploy time, CDM resolves these dependencies and wires up cross-contract references so that `counter::cdm_reference()` returns a handle to the deployed counter instance.

```
counter-writer --calls--> counter <--calls-- counter-reader
                           |
                      [shared state]
                        count: u32
```

## Usage

### Build

```bash
cdm build
```

### Deploy

```bash
cdm deploy --bootstrap ws://localhost:9944
```

This deploys all three contracts and registers them in the CDM registry.

### Validate

```bash
cd ts
bun install
bun run src/validate.ts
```

The validation script connects to the local chain, calls `write_increment()` via the writer contract, then reads back the count via the reader contract to verify cross-contract CDM calls work correctly.

### Test against a local network

```bash
pnpm install
cdm test
```

`cdm test` auto-starts the local Polkadot ecosystem (Product Preview Network) if it isn't running, deploys your contracts, populates `cdm.json` via `cdm install`, then runs vitest from `tests/`. See `tests/counter.test.ts` for the sample.

> **If your project is inside the cdm source monorepo for dev testing,** use `pnpm install --ignore-workspace` so the template gets its own `node_modules` instead of being absorbed by the parent workspace. From a standalone scaffolded project it's just `pnpm install`.

## Directory Structure

```
shared-counter/
  Cargo.toml                        # Workspace root
  contracts/
    counter/                         # Base counter contract (CDM provider)
      Cargo.toml
      lib.rs
      allocator.rs
    counter-writer/                  # Writer contract (CDM consumer)
      Cargo.toml
      lib.rs
      allocator.rs
    counter-reader/                  # Reader contract (CDM consumer)
      Cargo.toml
      lib.rs
      allocator.rs
  ts/
    package.json
    tsconfig.json
    src/
      validate.ts                    # End-to-end validation script
```
