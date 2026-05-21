#!/usr/bin/env bash
set -euo pipefail

CDM_DIR="${CDM_DIR:-$HOME/.cdm}"
REPO="${CDM_REPO:-paritytech/contract-dependency-manager}"
BIN="cdm"

case ":$PATH:" in
  *":$CDM_DIR/bin:"*|*":$HOME/.local/bin:"*) ALREADY_ON_PATH=1 ;;
  *) ALREADY_ON_PATH=0 ;;
esac

OS=$(uname -s)
case "$OS" in
  Linux) OS=linux ;;
  Darwin) OS=darwin ;;
  MINGW*|MSYS*|CYGWIN*)
    echo "Windows is not supported natively. Install WSL and re-run this command inside it." >&2
    exit 1
    ;;
  *) echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64) ARCH=x64 ;;
  arm64|aarch64) ARCH=arm64 ;;
  *) echo "Unsupported arch: $ARCH" >&2; exit 1 ;;
esac

if ! command -v curl >/dev/null 2>&1; then
  echo "Error: curl is required but not installed." >&2
  if [ "$OS" = "linux" ]; then
    echo "Install prerequisites first: sudo apt update && sudo apt install -y curl" >&2
  else
    echo "Install the Xcode Command Line Tools first: xcode-select --install" >&2
  fi
  exit 1
fi

# macOS IPv6 check
# PPN's p2p networking hits a polkadot-sdk bug on macOS with IPv6 enabled
# (https://github.com/paritytech/polkadot-sdk/issues/8918). Warn early so the
# user can disable IPv6 BEFORE running `cdm network start` and hitting
# confusing failures.
if [ "$OS" = "darwin" ]; then
  ACTIVE_IFACE=$(route -n get default 2>/dev/null | awk '/interface:/{print $2}' || true)
  if [ -n "$ACTIVE_IFACE" ]; then
    SERVICE=$(networksetup -listallhardwareports 2>/dev/null | awk -v iface="$ACTIVE_IFACE" 'BEGIN{p=""} /Hardware Port:/{p=$0} $0 ~ "Device: "iface{sub(/Hardware Port: /,"",p); print p; exit}' || true)
    if [ -n "$SERVICE" ]; then
      IPV6=$(networksetup -getinfo "$SERVICE" 2>/dev/null | awk -F': ' '/^IPv6:/{print $2}' || true)
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

TAG="${VERSION:-${CDM_TAG:-}}"
if [ -z "$TAG" ]; then
  TAG=$(curl -fsSI -H "Cache-Control: no-cache" -H "Pragma: no-cache" \
    "https://github.com/$REPO/releases/latest" \
    | sed -n 's|^[Ll][Oo][Cc][Aa][Tt][Ii][Oo][Nn]:[[:space:]]*.*/tag/\(.*\)$|\1|p' \
    | tr -d '\r' | head -n1) || true
fi
[ -z "$TAG" ] && echo "Could not determine latest release" >&2 && exit 1
case "$TAG" in
  v*|*/*) ;;
  [0-9]*) TAG="v$TAG" ;;
esac

ASSET="$BIN-$OS-$ARCH"

spin() {
  while true; do
    for c in '|' '/' '-' '\'; do
      printf "\r%s %s" "$1" "$c"
      sleep 0.1
    done
  done
}

spin "Installing $BIN ($OS/$ARCH) $TAG" &
SPIN_PID=$!
cleanup_spinner() {
  kill "$SPIN_PID" 2>/dev/null || true
}
trap cleanup_spinner EXIT

mkdir -p "$CDM_DIR/bin" "$HOME/.local/bin"
curl -fsSL -L "https://github.com/$REPO/releases/download/$TAG/$ASSET" -o "$CDM_DIR/bin/$BIN"
chmod +x "$CDM_DIR/bin/$BIN"
if [ "$OS" = "darwin" ]; then
  codesign --sign - --force "$CDM_DIR/bin/$BIN" 2>/dev/null || true
  xattr -c "$CDM_DIR/bin/$BIN" 2>/dev/null || true
fi
ln -sf "$CDM_DIR/bin/$BIN" "$HOME/.local/bin/$BIN"

kill "$SPIN_PID" 2>/dev/null || true
wait "$SPIN_PID" 2>/dev/null || true
trap - EXIT
printf "\rInstalled %s (%s/%s) %s -> %s/bin/%s   \n" "$BIN" "$OS" "$ARCH" "$TAG" "$CDM_DIR" "$BIN"

append_once() {
  local file="$1" line="$2"
  grep -Fqx "$line" "$file" 2>/dev/null || printf "\n%s\n" "$line" >> "$file"
}

if command -v bash >/dev/null 2>&1; then
  append_once "$HOME/.bashrc" 'export PATH="$HOME/.cdm/bin:$HOME/.local/bin:$PATH"'
  if [ ! -e "$HOME/.bash_profile" ]; then
    for legacy in .bash_login .profile; do
      if [ -f "$HOME/$legacy" ]; then
        printf '[ -f "$HOME/%s" ] && . "$HOME/%s"\n' "$legacy" "$legacy" >> "$HOME/.bash_profile"
        break
      fi
    done
  fi
  append_once "$HOME/.bash_profile" '[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"'
fi

if command -v zsh >/dev/null 2>&1; then
  append_once "$HOME/.zshrc" 'export PATH="$HOME/.cdm/bin:$HOME/.local/bin:$PATH"'
fi

if command -v fish >/dev/null 2>&1; then
  mkdir -p "$HOME/.config/fish"
  append_once "$HOME/.config/fish/config.fish" 'fish_add_path $HOME/.cdm/bin $HOME/.local/bin'
fi

export PATH="$CDM_DIR/bin:$HOME/.local/bin:$PATH"

if [ "${CDM_SKIP_SETUP:-0}" != "1" ]; then
  echo ""
  echo "Setting up CDM dependencies..."
  if [ -n "${CDM_CARGO_PVM_CONTRACT_REF:-}" ]; then
    "$CDM_DIR/bin/$BIN" setup --cargo-pvm-contract-ref "$CDM_CARGO_PVM_CONTRACT_REF"
  else
    "$CDM_DIR/bin/$BIN" setup
  fi

  # Build the ContractRegistry bytecode locally and stash it at ~/.cdm/share/.
  # `cdm deploy --bootstrap` (and `cdm test`'s auto-bootstrap path) read from
  # there when the user project doesn't have the contract-registry crates in
  # its own workspace.
  #
  # We shallow-clone the cdm source into ~/.cdm/share/cdm-source/ so the
  # contract crates have their full Cargo workspace context (they inherit
  # `version.workspace = true` etc). The clone also serves as a reusable
  # checkout for future rebuilds.
  mkdir -p "$CDM_DIR/share"
  SOURCE_DIR="$CDM_DIR/share/cdm-source"
  echo "Cloning $REPO @ $TAG for the ContractRegistry source..."
  rm -rf "$SOURCE_DIR"
  if git clone --depth 1 --branch "$TAG" "https://github.com/$REPO.git" "$SOURCE_DIR" 2>&1 \
    || git clone --depth 1 "https://github.com/$REPO.git" "$SOURCE_DIR" 2>&1; then
    echo "Building ContractRegistry bytecode (this may take a minute)..."
    if (cd "$SOURCE_DIR" \
      && cargo pvm-contract build --manifest-path Cargo.toml -p contract-registry \
      && cargo pvm-contract build --manifest-path Cargo.toml -p contract-registry-proxy); then
      cp "$SOURCE_DIR/target/release/contract-registry.polkavm" \
        "$SOURCE_DIR/target/release/contract-registry-proxy.polkavm" \
        "$CDM_DIR/share/"
      echo "ContractRegistry built → $CDM_DIR/share/"
    else
      echo "Warning: failed to build ContractRegistry."
      echo "  cdm deploy --bootstrap will fall back to looking for it in your project's target/release/."
    fi
  else
    echo "Warning: failed to clone $REPO. ContractRegistry bytecode will not be available."
    echo "  cdm deploy --bootstrap will fall back to looking for it in your project's target/release/."
  fi

  # Install Product Preview Network (PPN) into ~/.cdm/ppn/ so `cdm test` and
  # `cdm network start` have a local Polkadot ecosystem ready to go. Best-effort:
  # PPN's installer needs `gh auth login` or GITHUB_TOKEN — skip silently if
  # missing, the user can run `cdm network start` later to retry.
  if [ ! -d "$CDM_DIR/ppn" ]; then
    if { command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; } || [ -n "${GITHUB_TOKEN:-}" ]; then
      echo "Installing Product Preview Network into $CDM_DIR/ppn..."
      (cd "$CDM_DIR" && curl -sL https://raw.githubusercontent.com/paritytech/ppn-proxy/main/install.sh | bash) \
        && echo "PPN installed." \
        || echo "PPN install failed — run 'cdm network start' later to retry."
    else
      echo "Skipping PPN install (needs 'gh auth login' or GITHUB_TOKEN). Run 'cdm network start' later to install on demand."
    fi
  fi
fi

echo ""
echo "cdm is ready. Try:"
echo "  cdm template shared-counter"
echo "  cdm init"
echo "  cdm account map -n paseo"
echo "  cdm deploy -n paseo"

if [ "$ALREADY_ON_PATH" = "0" ]; then
  case "$(basename "${SHELL:-bash}")" in
    zsh) RC="$HOME/.zshrc" ;;
    fish) RC="$HOME/.config/fish/config.fish" ;;
    *) RC="$HOME/.bashrc" ;;
  esac
  echo ""
  echo "Open a new terminal or run: source ${RC/#$HOME/\$HOME}"
fi
