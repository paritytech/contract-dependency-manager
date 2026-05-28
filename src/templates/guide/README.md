# Guide Example

This template demonstrates a small two-contract CDM workspace. The `app-api` contract owns shared state, and the `support-contract` contract calls it through a typed CDM import.

## Contracts

### `app-api` (`@example/app-api`)

The provider contract that stores and exposes a counter.

### `support-contract` (`@example/support-contract`)

The consumer contract. It imports `@example/app-api` with `cdm::import!` and calls `app_api::AppApi::cdm_lookup()` at runtime.

## Usage

```bash
cdm build
cdm deploy -n paseo
```

Before deploying, change the `[package.metadata.cdm] package = "@example/..."` values in each contract's `Cargo.toml` to package names you own.
