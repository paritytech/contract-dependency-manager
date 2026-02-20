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

# 2) Ensure Rust toolchain is installed with nightly + rust-src (needed for PolkaVM targets)
if ! command -v rustup >/dev/null 2>&1; then
  echo "Installing Rust via rustup..."
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
  . "$HOME/.cargo/env"
fi
if ! rustup toolchain list | grep -q nightly; then
  echo "Installing Rust nightly toolchain..."
  rustup toolchain install nightly
fi
if ! rustup component list --toolchain nightly | grep -q "rust-src (installed)"; then
  echo "Installing rust-src for nightly..."
  rustup component add rust-src --toolchain nightly
fi

# 3) Detect platform
OS=$(uname -s); case "$OS" in Linux) OS=linux;; Darwin) OS=darwin;; *) echo "Unsupported OS: $OS"; exit 1;; esac
ARCH=$(uname -m); case "$ARCH" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo "Unsupported arch: $ARCH"; exit 1;; esac
ASSET="$BIN-$OS-$ARCH"

# 4) Fetch latest release (private repo — use API asset URL, not browser URL)
TAG=${CDM_TAG:-$(curl -fsSL -H "$AUTH" "https://api.github.com/repos/$REPO/releases/latest" \
      | sed -n 's/.*"tag_name":[[:space:]]*"\(.*\)".*/\1/p' | head -n1)}
[ -z "$TAG" ] && echo "Could not determine latest release" && exit 1

RELEASE_JSON=$(curl -fsSL -H "$AUTH" "https://api.github.com/repos/$REPO/releases/latest")
ASSET_URL=$(echo "$RELEASE_JSON" | grep -B3 "\"name\": \"$ASSET\"" | grep '"url"' | head -1 | cut -d'"' -f4)
[ -z "$ASSET_URL" ] && echo "Asset $ASSET not found in release $TAG" && exit 1

# 5) Install binary
mkdir -p "$CDM_DIR/bin" "$HOME/.local/bin"
curl -fsSL -H "$AUTH" -H "Accept: application/octet-stream" -L "$ASSET_URL" -o "$CDM_DIR/bin/$BIN"
chmod +x "$CDM_DIR/bin/$BIN"
ln -sf "$CDM_DIR/bin/$BIN" "$HOME/.local/bin/$BIN"

echo "Installed $BIN ($OS/$ARCH) from $TAG -> $CDM_DIR/bin/$BIN"

# 6) Install cargo-pvm-contract from the cdm-integration branch
#    The repo's .cargo/config.toml sets a PolkaVM RISC-V default target, so we must
#    explicitly pass --target for the host platform to build the CLI tool for the host.
HOST_TARGET=$(rustc -vV | grep '^host:' | cut -d' ' -f2)
echo "Installing cargo-pvm-contract..."
if git clone -b charles/cdm-integration https://github.com/paritytech/cargo-pvm-contract.git /tmp/cargo-pvm-contract 2>&1; then
  if cargo install --force --locked --target "$HOST_TARGET" --path /tmp/cargo-pvm-contract/crates/cargo-pvm-contract; then
    echo "cargo-pvm-contract installed."
  else
    echo "Error: cargo-pvm-contract failed to build. Check Rust toolchain setup."
  fi
  rm -rf /tmp/cargo-pvm-contract
else
  echo "Error: Failed to clone cargo-pvm-contract repository."
fi

# 7) Add to PATH in all available shell profiles

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
