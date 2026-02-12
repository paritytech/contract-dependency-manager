#!/bin/bash
set -euo pipefail

# CDM Installer — curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash

REPO="paritytech/contract-dependency-manager"
INSTALL_DIR="${CDM_INSTALL_DIR:-$HOME/.cdm/bin}"

case "$(uname -s)-$(uname -m)" in
    Darwin-arm64|Darwin-aarch64) BINARY="cdm-darwin-arm64" ;;
    Darwin-x86_64)               BINARY="cdm-darwin-x64" ;;
    Linux-x86_64)                BINARY="cdm-linux-x64" ;;
    *) echo "Unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -z "$LATEST" ] && echo "Could not determine latest release" && exit 1

echo "Installing CDM $LATEST ($BINARY)..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "https://github.com/$REPO/releases/download/$LATEST/$BINARY" -o "$INSTALL_DIR/cdm"
chmod +x "$INSTALL_DIR/cdm"

echo "Installed to $INSTALL_DIR/cdm"
if ! command -v cdm &>/dev/null; then
    echo "Add to PATH: export PATH=\"$INSTALL_DIR:\$PATH\""
fi
