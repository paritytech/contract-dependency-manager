#!/bin/bash
set -euo pipefail

# CDM Deploy Helper
# Builds and deploys all contracts to a target chain
# Requires a running chain with the Revive pallet (e.g. PPN Asset Hub)
# Start PPN: cd ppn && make start

URL="${1:-ws://127.0.0.1:10020}"
SIGNER="${2:-Alice}"

echo "=== CDM Deploy ==="
echo "Target: $URL"
echo "Signer: $SIGNER"
echo ""

# Build registry first
echo "Building ContractRegistry..."
cargo pvm-contract build --manifest-path Cargo.toml -p contracts

echo ""

# Deploy with bootstrap (fresh registry + all contracts)
echo "Deploying..."
bun run src/cli.ts deploy --bootstrap --signer "$SIGNER" "$URL"
