#!/bin/bash
set -euo pipefail

# Contract Dependency Manager (CDM) Installer
# Usage: curl -fsSL https://raw.githubusercontent.com/paritytech/contract-dependency-manager/main/install.sh | bash

REPO="paritytech/contract-dependency-manager"
INSTALL_DIR="${CDM_INSTALL_DIR:-$HOME/.cdm/bin}"
BOLD="\033[1m"
GREEN="\033[0;32m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${BOLD}CDM Installer${RESET}"
echo ""

# Detect OS and architecture
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
ARCH=$(uname -m)

case "$OS-$ARCH" in
    darwin-arm64|darwin-aarch64)
        BINARY="cdm-darwin-arm64"
        ;;
    darwin-x86_64)
        BINARY="cdm-darwin-x64"
        ;;
    linux-x86_64)
        BINARY="cdm-linux-x64"
        ;;
    *)
        echo -e "${RED}Error: Unsupported platform: $OS-$ARCH${RESET}"
        echo "CDM supports: macOS (arm64, x64), Linux (x64)"
        exit 1
        ;;
esac

echo "Platform: $OS/$ARCH"
echo "Binary:   $BINARY"
echo ""

# Get latest release tag
echo "Fetching latest release..."
LATEST=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)

if [ -z "$LATEST" ]; then
    echo -e "${RED}Error: Could not determine latest release${RESET}"
    exit 1
fi

echo "Version:  $LATEST"

URL="https://github.com/$REPO/releases/download/$LATEST/$BINARY"

# Download
echo "Downloading $URL..."
mkdir -p "$INSTALL_DIR"
curl -fsSL "$URL" -o "$INSTALL_DIR/cdm"
chmod +x "$INSTALL_DIR/cdm"

# Verify
if [ ! -x "$INSTALL_DIR/cdm" ]; then
    echo -e "${RED}Error: Installation failed${RESET}"
    exit 1
fi

VERSION=$("$INSTALL_DIR/cdm" --version 2>/dev/null || echo "unknown")
echo ""
echo -e "${GREEN}CDM $VERSION installed successfully!${RESET}"
echo ""

# Check if already in PATH
if command -v cdm &>/dev/null; then
    echo "cdm is already in your PATH."
else
    echo "Add CDM to your PATH by adding this to your shell profile:"
    echo ""
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    echo ""

    # Detect shell and suggest the right file
    SHELL_NAME=$(basename "$SHELL")
    case "$SHELL_NAME" in
        zsh)  echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.zshrc" ;;
        bash) echo "  echo 'export PATH=\"$INSTALL_DIR:\$PATH\"' >> ~/.bashrc" ;;
        fish) echo "  fish_add_path $INSTALL_DIR" ;;
    esac
    echo ""
    echo "Then restart your shell or run: source ~/.*rc"
fi

echo ""
echo "Get started:"
echo "  cdm --help              Show available commands"
echo "  cdm template my-project Scaffold a new project"
