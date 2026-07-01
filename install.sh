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
