#!/usr/bin/env bash
set -euo pipefail

# Builds the on-chain CDM contracts with the globally installed mainline
# cargo-pvm-contract: the ContractRegistry implementation (src/contract), the
# EIP-1967 proxy that fronts both the registry and the resolver
# (src/contract/eip1967-proxy), the resolver implementation
# (src/contract/resolver), and the per-name shim (src/contract/proxy).
# Outputs land at target/release/<crate>.polkavm (+ .abi.json).

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

for crate in contract-registry contract-eip1967-proxy contract-resolver contract-proxy; do
    cargo pvm-contract build --manifest-path "$ROOT/Cargo.toml" -p "$crate"
done
