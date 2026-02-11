#!/bin/bash
set -euo pipefail

# CDM Development Setup Script

echo "=== CDM Development Setup ==="
echo ""

# Check prerequisites
check_cmd() {
    if ! command -v "$1" &>/dev/null; then
        echo "Error: $1 is not installed"
        echo "  $2"
        exit 1
    fi
    echo "  $1 $(command -v "$1")"
}

echo "Checking prerequisites..."
check_cmd bun "Install from https://bun.sh"
check_cmd cargo "Install from https://rustup.rs"
check_cmd cargo-pvm-contract "Install with: cargo install cargo-pvm-contract"

echo ""

# Install JS dependencies
echo "Installing dependencies..."
bun install

echo ""

# Generate papi descriptors
echo "Generating papi descriptors..."
bunx papi generate || echo "Warning: papi generate failed (may need chain connection)"

echo ""

# Build registry contract
echo "Building ContractRegistry..."
cargo pvm-contract build --manifest-path Cargo.toml -p contracts || echo "Warning: Registry build failed (check Rust toolchain)"

# Check for PPN (local network)
echo "Checking for PPN (Product Preview Net)..."
if [ -d "ppn" ] || [ -d "../ppn" ]; then
    echo "  PPN directory found"
else
    echo "  PPN not found. For local development, install PPN:"
    echo "    curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash"
    echo "    cd ppn && make start"
    echo "  This provides a local Asset Hub at ws://127.0.0.1:10020"
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  bun run src/cli.ts --help    Run CDM in dev mode"
echo "  make test                     Run tests"
echo "  make compile                  Build native binary"
