# CDM Installer

CDM_DIR="$HOME/.cdm"
REPO="paritytech/contract-dependency-manager"
BIN="cdm"

# 1) Resolve GitHub token from env or git credentials
if [ -z "${GITHUB_TOKEN:-}" ]; then
    GITHUB_TOKEN=$(printf "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | grep "^password=" | cut -d= -f2 || true)
fi
if [ -z "${GITHUB_TOKEN:-}" ]; then
    echo "Error: No GitHub token found. Run 'gh auth login' or set GITHUB_TOKEN."
    exit 1
fi

AUTH="Authorization: token $GITHUB_TOKEN"

# 2) Detect platform
OS=$(uname -s); case "$OS" in Linux) OS=linux;; Darwin) OS=darwin;; *) echo "Unsupported OS: $OS"; exit 1;; esac
ARCH=$(uname -m); case "$ARCH" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo "Unsupported arch: $ARCH"; exit 1;; esac
ASSET="$BIN-$OS-$ARCH"

# 3) Fetch latest release (private repo — use API asset URL, not browser URL)
TAG=${CDM_TAG:-$(curl -fsSL -H "$AUTH" "https://api.github.com/repos/$REPO/releases/latest" \
      | sed -n 's/.*"tag_name":[[:space:]]*"\(.*\)".*/\1/p' | head -n1)}
[ -z "$TAG" ] && echo "Could not determine latest release" && exit 1

RELEASE_JSON=$(curl -fsSL -H "$AUTH" "https://api.github.com/repos/$REPO/releases/latest")
ASSET_URL=$(echo "$RELEASE_JSON" | grep -B3 "\"name\": \"$ASSET\"" | grep '"url"' | head -1 | cut -d'"' -f4)
[ -z "$ASSET_URL" ] && echo "Asset $ASSET not found in release $TAG" && exit 1

# 4) Install binary
mkdir -p "$CDM_DIR/bin" "$HOME/.local/bin"
curl -fsSL -H "$AUTH" -H "Accept: application/octet-stream" -L "$ASSET_URL" -o "$CDM_DIR/bin/$BIN"
chmod +x "$CDM_DIR/bin/$BIN"
ln -sf "$CDM_DIR/bin/$BIN" "$HOME/.local/bin/$BIN"

echo "Installed $BIN ($OS/$ARCH) from $TAG -> $CDM_DIR/bin/$BIN"

# 5) Add to PATH in all available shell profiles

append_once() { # append $2 to file $1 if not already present
  local file="$1" line="$2"
  grep -Fqx "$line" "$file" 2>/dev/null || printf "\n%s\n" "$line" >> "$file"
}

# bash
if command -v bash >/dev/null 2>&1; then
  append_once "$HOME/.bashrc" 'export PATH="$HOME/.cdm/bin:$HOME/.local/bin:$PATH"'
  append_once "$HOME/.bash_profile" '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"'
  echo "bash PATH configured"
fi

# zsh
if command -v zsh >/dev/null 2>&1; then
  append_once "$HOME/.zshrc" 'export PATH="$HOME/.cdm/bin:$HOME/.local/bin:$PATH"'
  echo "zsh PATH configured"
fi

# fish
if command -v fish >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/fish"
  append_once "$HOME/.config/fish/config.fish" 'fish_add_path $HOME/.cdm/bin $HOME/.local/bin'
  echo "fish PATH configured"
fi

echo "Restart your shell or open a new terminal to use cdm."
