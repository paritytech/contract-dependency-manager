# Counter

The base counter contract that owns shared on-chain state. Other contracts interact with it via CDM cross-contract references.

## Methods

- **`increment()`** - Increments the counter by 1
- **`get_count()`** - Returns the current counter value
- **`get_owner()`** - Returns the owner recorded by the 0.1.0 initialization

## Storage

The storage struct lives in `storage.rs` and is shared — via the SDK's nested-storage API — between the main contract (`lib.rs`) and every initialization under `initializations/`, so an initialization can never drift from the layout it writes to.

- `count: u32` - The shared counter value
- `owner: Address` - Set once when 0.1.0 is published

## Initializations

`initializations/0.1.0.rs` runs exactly once, when version 0.1.0 is published: it records the publisher as the contract's owner. Each initialization is its own `[[bin]]` target (see `Cargo.toml`); a file named `X.Y.Z.rs` runs when exactly that version is published and is inert forever after.

## CDM Package

Published as `@example/counter`. Other contracts can import this package with `cdm::import!("@example/counter")` and call it via `counter::Counter::cdm_lookup()`.
