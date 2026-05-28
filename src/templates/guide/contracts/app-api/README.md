# App API

The app API contract owns shared on-chain state. Other contracts interact with it via CDM cross-contract references.

## Methods

- **`increment()`** - Increments the counter by 1
- **`get_count()`** - Returns the current counter value

## Storage

- `count: u32` - The shared counter value

## CDM Package

Published as `@example/app-api`. Other contracts can import this package with `cdm::import!("@example/app-api")` and call it via `app_api::AppApi::cdm_lookup()`.
