# Counter

The base counter contract that owns shared on-chain state. Other contracts interact with it via CDM cross-contract references.

## Methods

- **`increment()`** - Increments the counter by 1
- **`get_count()`** - Returns the current counter value

## Storage

- `count: u32` - The shared counter value

## CDM Package

Published as `@example/counter`. Other contracts can depend on this package to call its methods via `counter::cdm_reference()`.
