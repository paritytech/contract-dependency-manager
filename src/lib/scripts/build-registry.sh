#!/usr/bin/env bash
set -euo pipefail

# Builds the on-chain CDM contracts.
#
# Rust on PolkaVM, with the globally installed mainline cargo-pvm-contract as
# the linker: the EIP-1967 proxy that fronts both the registry and the
# resolver (src/contract/eip1967-proxy), the shim factory the registry
# delegate-calls (src/contract/shim-factory), and the per-name shim
# (src/contract/proxy). Outputs land at target/release/<crate>.polkavm.
#
# Solidity on EVM, with forge: the registry and resolver implementations
# (src/contract/solidity). Outputs land at src/contract/solidity/out/.

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

for crate in contract-eip1967-proxy contract-shim-factory contract-proxy; do
    cargo pvm-contract build --manifest-path "$ROOT/Cargo.toml" -p "$crate"
done

forge build --root "$ROOT/src/contract/solidity"
