# Instagram Example

This template contains a single Rust PolkaVM contract plus a small frontend for creating and reading posts. The contract is published as `@example/instagram` by the `[package.metadata.cdm]` entry in `contracts/instagram/Cargo.toml`.

## Contract

The `instagram` contract stores post counts, post data, and a simple user index. Posts are keyed by `(user_address, sequential_index)`, so clients can build feeds without an on-chain global feed.

## Usage

```bash
cdm build
cdm deploy -n paseo
```

Before deploying, change `package = "@example/instagram"` in the contract `Cargo.toml` to a package name you own.
