#!/usr/bin/env bash
set -euo pipefail

# Builds the on-chain ContractRegistry implementation (src/contract) and its
# EIP-1967 proxy (src/contract/proxy) with the globally installed mainline
# cargo-pvm-contract. Outputs land at:
#   target/release/contract-registry.polkavm        (+ .abi.json)
#   target/release/contract-registry-proxy.polkavm  (+ .abi.json)

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"

cargo pvm-contract build --manifest-path "$ROOT/Cargo.toml" -p contract-registry
cargo pvm-contract build --manifest-path "$ROOT/Cargo.toml" -p contract-registry-proxy
