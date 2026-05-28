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

# 2a) macOS IPv6 check
# PPN's p2p networking hits a polkadot-sdk bug on macOS with IPv6 enabled
# (https://github.com/paritytech/polkadot-sdk/issues/8918). Warn early so the
# user can disable IPv6 BEFORE running `cdm network start` and hitting
# confusing failures.
if [ "$(uname -s)" = "Darwin" ]; then
  ACTIVE_IFACE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')
  if [ -n "$ACTIVE_IFACE" ]; then
    SERVICE=$(networksetup -listallhardwareports 2>/dev/null | awk -v iface="$ACTIVE_IFACE" 'BEGIN{p=""} /Hardware Port:/{p=$0} $0 ~ "Device: "iface{sub(/Hardware Port: /,"",p); print p; exit}')
    if [ -n "$SERVICE" ]; then
      IPV6=$(networksetup -getinfo "$SERVICE" 2>/dev/null | awk -F': ' '/^IPv6:/{print $2}')
      if [ "$IPV6" != "Off" ] && [ -n "$IPV6" ]; then
        echo
        echo "⚠️  macOS IPv6 is enabled on '$SERVICE'. PPN's p2p networking"
        echo "    fails on macOS with IPv6 on (polkadot-sdk#8918). Disable with:"
        echo "      sudo networksetup -setv6off \"$SERVICE\""
        echo "    Re-enable later with:"
        echo "      sudo networksetup -setv6automatic \"$SERVICE\""
        echo
      fi
    fi
  fi
fi

# 2) Detect platform
OS=$(uname -s); case "$OS" in Linux) OS=linux;; Darwin) OS=darwin;; *) echo "Unsupported OS: $OS"; exit 1;; esac
ARCH=$(uname -m); case "$ARCH" in x86_64|amd64) ARCH=x64;; arm64|aarch64) ARCH=arm64;; *) echo "Unsupported arch: $ARCH"; exit 1;; esac
ASSET="$BIN-$OS-$ARCH"

# 3) Fetch latest release tag (uses redirect URL to avoid GitHub API rate limits)
TAG=${CDM_TAG:-$(curl -fsSI "https://github.com/$REPO/releases/latest" \
      | sed -n 's|^location:.*/tag/\(.*\)$|\1|p' | tr -d '\r' | head -n1)}
[ -z "$TAG" ] && echo "Could not determine latest release" && exit 1

# 4) Install binary
mkdir -p "$CDM_DIR/bin" "$HOME/.local/bin"
curl -fsSL -L "https://github.com/$REPO/releases/download/$TAG/$ASSET" -o "$CDM_DIR/bin/$BIN"
chmod +x "$CDM_DIR/bin/$BIN"
ln -sf "$CDM_DIR/bin/$BIN" "$HOME/.local/bin/$BIN"

echo "Installed $BIN ($OS/$ARCH) from $TAG -> $CDM_DIR/bin/$BIN"

# 5) Install cargo-pvm-contract from the new CDM SDK/storage branch
#    The repo's .cargo/config.toml sets a PolkaVM RISC-V default target, so we must
#    explicitly pass --target for the host platform to build the CLI tool for the host.
HOST_TARGET=$(rustc -vV | grep '^host:' | cut -d' ' -f2)
echo "Installing cargo-pvm-contract..."
rm -rf /tmp/cargo-pvm-contract
if git clone -b sm/cdm https://github.com/paritytech/cargo-pvm-contract.git /tmp/cargo-pvm-contract 2>&1; then
  if cargo install --force --locked --target "$HOST_TARGET" --path /tmp/cargo-pvm-contract/crates/cargo-pvm-contract; then
    echo "cargo-pvm-contract installed."
  else
    echo "Error: cargo-pvm-contract failed to build. Check Rust toolchain setup."
  fi
  rm -rf /tmp/cargo-pvm-contract
else
  echo "Error: Failed to clone cargo-pvm-contract repository."
fi

# 5b) Build the ContractRegistry bytecode locally and stash it at
#     ~/.cdm/share/. `cdm deploy --bootstrap` (and `cdm test`'s auto-bootstrap
#     path) read from there when the user project doesn't have the
#     contract-registry crate in its own workspace.
#
#     We shallow-clone the cdm source into ~/.cdm/share/cdm-source/ so the
#     contract crate has its full Cargo workspace context (it inherits
#     `version.workspace = true` etc). The clone also serves as a reusable
#     checkout for future rebuilds.
mkdir -p "$CDM_DIR/share"
SOURCE_DIR="$CDM_DIR/share/cdm-source"
echo "Cloning $REPO @ $TAG for the ContractRegistry source..."
rm -rf "$SOURCE_DIR"
if git clone --depth 1 --branch "$TAG" "https://github.com/$REPO.git" "$SOURCE_DIR" 2>&1 \
  || git clone --depth 1 "https://github.com/$REPO.git" "$SOURCE_DIR" 2>&1; then
  echo "Building ContractRegistry bytecode (this may take a minute)..."
  if (cd "$SOURCE_DIR" && cargo pvm-contract build --manifest-path Cargo.toml -p contract-registry); then
    cp "$SOURCE_DIR/target/contract-registry.release.polkavm" "$CDM_DIR/share/"
    echo "ContractRegistry built → $CDM_DIR/share/contract-registry.release.polkavm"
  else
    echo "Warning: failed to build ContractRegistry."
    echo "  cdm deploy --bootstrap will fall back to looking for it in your project's target/."
  fi
else
  echo "Warning: failed to clone $REPO. ContractRegistry bytecode will not be available."
  echo "  cdm deploy --bootstrap will fall back to looking for it in your project's target/."
fi

# 6) Install Product Preview Network (PPN) into ~/.cdm/ppn/ so `cdm test` and
#    `cdm network start` have a local Polkadot ecosystem ready to go. Best-effort:
#    PPN's installer needs `gh auth login` or GITHUB_TOKEN — skip silently if
#    missing, the user can run `cdm network start` later to retry.
if [ ! -d "$CDM_DIR/ppn" ]; then
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    echo "Installing Product Preview Network into $CDM_DIR/ppn..."
    (cd "$CDM_DIR" && curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash) \
      && echo "PPN installed." \
      || echo "PPN install failed — run 'cdm network start' later to retry."
  elif [ -n "${GITHUB_TOKEN:-}" ]; then
    echo "Installing Product Preview Network into $CDM_DIR/ppn..."
    (cd "$CDM_DIR" && curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash) \
      && echo "PPN installed." \
      || echo "PPN install failed — run 'cdm network start' later to retry."
  else
    echo "Skipping PPN install (needs 'gh auth login' or GITHUB_TOKEN). Run 'cdm network start' later to install on demand."
  fi
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

# 8) Make cdm available in the current session
export PATH="$HOME/.cdm/bin:$HOME/.local/bin:$PATH"

echo ""
echo "cdm is ready! Try:"
echo -e "\033[1mcdm template shared-counter\033[0m"
echo -e "\033[1mcdm init\033[0m"
echo -e "\033[1mcdm account map -n paseo\033[0m"
echo -e "\033[1mcdm deploy -n paseo\033[0m"
