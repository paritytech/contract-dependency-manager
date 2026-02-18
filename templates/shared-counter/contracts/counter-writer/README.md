# Counter Writer

A consumer contract that modifies the shared counter state via a CDM cross-contract reference. Demonstrates how to call mutating methods on another contract.

## Methods

- **`write_increment()`** - Increments the shared counter by 1
- **`write_increment_n(n)`** - Increments the shared counter `n` times in a single call

## Dependencies

- `@example/counter` - The base counter contract providing `increment()`
