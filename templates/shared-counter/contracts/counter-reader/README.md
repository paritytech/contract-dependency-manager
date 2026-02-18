# Counter Reader

A consumer contract that reads the shared counter state via a CDM cross-contract reference. Demonstrates how to depend on another contract's methods without owning the state.

## Methods

- **`read_count()`** - Reads and returns the current count from the `@example/counter` contract

## Dependencies

- `@example/counter` - The base counter contract providing `get_count()`
