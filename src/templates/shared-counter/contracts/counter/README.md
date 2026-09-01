# Counter

The base counter contract that owns shared on-chain state. Other contracts interact with it via CDM cross-contract references.

## Methods

- **`increment()`** - Increments the counter by 1
- **`get_count()`** - Returns the current counter value
- **`get_owner()`** - Returns the owner recorded by the 0.1.0 initialization

## Initializations

`initializations/0.1.0.rs` runs exactly once, when version 0.1.0 is published: it records the publisher as the contract's owner. A file named `X.Y.Z.rs` runs when exactly that version is published and is inert forever after — and it needs nothing beyond the file itself: `cdm deploy` builds it on its own. Each initialization embeds its own copy of the storage layout it operates on, which CDM verifies against the contract at deploy time.

## CDM Package

Published as `@example/counter`. Other contracts can import this package with `cdm::import!("@example/counter")` and call it via `counter::Counter::cdm_lookup()`.
