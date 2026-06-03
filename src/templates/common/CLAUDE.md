# CLAUDE.md

Guidance for working in this CDM template.

## Toolchain

Rust contracts use `pvm_contract_sdk` from `paritytech/cargo-pvm-contract` branch `sm/cdm` and build with:

```bash
cdm build
# or, for one workspace member:
cargo pvm-contract build --manifest-path Cargo.toml -p <crate-name>
```

Contract bytecode and ABI artifacts are written under `target/release/` by the new `cargo pvm-contract build` command.

## CDM Package Identity

Rust CDM package names live in each contract's `Cargo.toml`, not in the source macro:

```toml
[package.metadata.cdm]
package = "@yourorg/contract-name"
```

Change all `@example/...` package names before deploying. Package names are global per registry target.

## Contract Shape

Use the new SDK macros:

```rust
#![cfg_attr(not(feature = "abi-gen"), no_main, no_std)]

#[pvm_contract_sdk::contract(allocator = "pico", allocator_size = 1024)]
mod my_contract {
    pub struct MyContract;

    impl MyContract {
        #[pvm_contract_sdk::constructor]
        pub fn new(&mut self) {}

        #[pvm_contract_sdk::method]
        pub fn value(&self) -> u32 {
            42
        }
    }
}
```

When a contract uses allocation, keep `picoalloc`/`polkavm-derive` dependencies and the allocator setup used by the template.

## Cross-Contract Imports

Use `cdm::import!` for both local workspace contracts and installed external contracts:

```rust
cdm::import!("@example/counter");

let counter = counter::Counter::cdm_lookup();
counter.increment().call(self).expect("increment failed");
```

The import macro resolves in this order:

1. Local workspace package with matching `[package.metadata.cdm] package`.
2. Installed ABI from `cdm.json` and project `.cdm`.

For local workspace imports, declare the dependency in CDM metadata so CDM can
infer build and deploy order without linking full contract crates together:

```toml
[package.metadata.cdm]
package = "@example/consumer"
dependencies = ["@example/counter"]
```

Do not add a normal Cargo dependency on another contract crate unless you are
intentionally sharing ordinary Rust library code; importing a second contract
crate directly can pull in duplicate contract runtime items.

## Storage

Prefer the storage helpers re-exported by `pvm_contract_sdk`, such as `Lazy`, `Mapping`, `LazyString`, and `MappingString`. The current target branch supports storage composition and dynamic string/bytes storage, but arbitrary vector storage still needs explicit modelling with mappings.

## Deployment

Use:

```bash
cdm init -n paseo
cdm account map -n paseo
cdm deploy -n paseo
```

`cdm deploy` builds contracts in dependency order, deploys them, publishes metadata, and registers package names in the CDM registry.
