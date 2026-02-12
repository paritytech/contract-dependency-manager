# CDM Installer

REPO="paritytech/contract-dependency-manager"
INSTALL_DIR="${CDM_INSTALL_DIR:-$HOME/.cdm/bin}"

# Resolve GitHub token from env or git credentials
if [ -z "${GITHUB_TOKEN:-}" ]; then
    GITHUB_TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | grep "^password=" | cut -d= -f2 || true)
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "Error: No GitHub token found. Run 'gh auth login' or set GITHUB_TOKEN."
    exit 1
fi

AUTH="Authorization: token $GITHUB_TOKEN"

case "$(uname -s)-$(uname -m)" in
    Darwin-arm64|Darwin-aarch64) BINARY="cdm-darwin-arm64" ;;
    Darwin-x86_64)               BINARY="cdm-darwin-x64" ;;
    Linux-x86_64)                BINARY="cdm-linux-x64" ;;
    *) echo "Unsupported platform: $(uname -s)-$(uname -m)"; exit 1 ;;
esac

LATEST=$(curl -fsSL -H "$AUTH" "https://api.github.com/repos/$REPO/releases/latest" | grep '"tag_name"' | head -1 | cut -d'"' -f4)
[ -z "$LATEST" ] && echo "Could not determine latest release" && exit 1

# Get the asset API URL (not browser_download_url — that 404s on private repos)
RELEASE_JSON=$(curl -fsSL -H "$AUTH" "https://api.github.com/repos/$REPO/releases/latest")
ASSET_URL=$(echo "$RELEASE_JSON" | grep -B3 "\"name\": \"$BINARY\"" | grep '"url"' | head -1 | cut -d'"' -f4)
[ -z "$ASSET_URL" ] && echo "Asset $BINARY not found in release $LATEST" && exit 1

echo "Installing CDM $LATEST ($BINARY)..."
mkdir -p "$INSTALL_DIR"
curl -fsSL -H "$AUTH" -H "Accept: application/octet-stream" -L "$ASSET_URL" -o "$INSTALL_DIR/cdm"
chmod +x "$INSTALL_DIR/cdm"

echo "Installed to $INSTALL_DIR/cdm"
if ! command -v cdm &>/dev/null; then
    echo "Add to PATH: export PATH=\"$INSTALL_DIR:\$PATH\""
fi