# Counter

The base counter contract that owns shared on-chain state. Other contracts interact with it via CDM cross-contract references.

## Methods

- **`increment()`** - Increments the counter by 1
- **`get_count()`** - Returns the current counter value

## Initializations

`initializations/X.Y.Z.rs` runs exactly once, when version X.Y.Z is published; `cdm deploy` builds it on its own. Each file declares its own copy of the contract's storage layout, which CDM verifies at deploy time. The shipped `0.1.0.rs` just zeroes the counter to demonstrate the shape.

## CDM Package

Published as `@example/counter`. Other contracts can import this package with `cdm::import!("@example/counter")` and call it via `counter::Counter::cdm_lookup()`.
