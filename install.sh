# CDM Installer

CDM_DIR="$HOME/.cdm"
REPO="paritytech/contract-dependency-manager"
BIN="cdm"

# 1) Ensure Rust toolchain is installed with nightly + rust-src (needed for PolkaVM targets)
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

# 2) Detect platform
OS=$(uname -s); case "$OS" in Linux) OS=linux;; Darwin) OS=darwin;; *) echo "Unsupported OS: $OS"; exit 1;; esac
ARCH=$(uname -m); case "$ARCH" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo "Unsupported arch: $ARCH"; exit 1;; esac
ASSET="$BIN-$OS-$ARCH"

# 3) Fetch latest release tag
TAG=${CDM_TAG:-$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
      | sed -n 's/.*"tag_name":[[:space:]]*"\(.*\)".*/\1/p' | head -n1)}
[ -z "$TAG" ] && echo "Could not determine latest release" && exit 1

# 4) Install binary
mkdir -p "$CDM_DIR/bin" "$HOME/.local/bin"
curl -fsSL -L "https://github.com/$REPO/releases/download/$TAG/$ASSET" -o "$CDM_DIR/bin/$BIN"
chmod +x "$CDM_DIR/bin/$BIN"
ln -sf "$CDM_DIR/bin/$BIN" "$HOME/.local/bin/$BIN"

echo "Installed $BIN ($OS/$ARCH) from $TAG -> $CDM_DIR/bin/$BIN"

# 5) Install cargo-pvm-contract from the cdm-integration branch
#    The repo's .cargo/config.toml sets a PolkaVM RISC-V default target, so we must
#    explicitly pass --target for the host platform to build the CLI tool for the host.
HOST_TARGET=$(rustc -vV | grep '^host:' | cut -d' ' -f2)
echo "Installing cargo-pvm-contract..."
rm -rf /tmp/cargo-pvm-contract
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
echo ""
echo -e "\033[1mcdm template shared-counter\033[0m"
echo -e "\033[1mcdm deploy -n preview-net\033[0m"
