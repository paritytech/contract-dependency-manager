#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'USAGE'
Usage: src/lib/scripts/deploy-frontend.sh <mnemonic> [polkadot-app-deploy args...]
       src/lib/scripts/deploy-frontend.sh --dry-run

Builds the CDM frontend and deploys it with polkadot-app-deploy 0.16.1.
The target is contracts.paseo on paseo-next-v2, or contracts.dot on devnet.

Examples:
  src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI"
  APP_DEPLOY_ENV=devnet src/lib/scripts/deploy-frontend.sh --dry-run

Environment:
  APP_DEPLOY_ENV           paseo-next-v2 (default) or devnet
  SKIP_APP_DEPLOY_INSTALL  Set to 1 to use an already installed 0.16.1 binary

--dry-run prints the target without installing, building, or deploying.
USAGE
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 0
fi
if [[ $# -lt 1 || -z "$1" ]]; then
    usage >&2
    exit 1
fi

ENV_ID="${APP_DEPLOY_ENV:-paseo-next-v2}"
case "$ENV_ID" in
    paseo-next-v2) DOMAIN="contracts.paseo" ;;
    devnet) DOMAIN="contracts.dot" ;;
    *) echo 'APP_DEPLOY_ENV must be paseo-next-v2 or devnet.' >&2; exit 1 ;;
esac

if [[ "$1" == "--dry-run" ]]; then
    [[ $# -eq 1 ]] || { echo '--dry-run takes no other arguments.' >&2; exit 1; }
    printf 'Tool: @parity/polkadot-app-deploy@0.16.1\nEnvironment: %s\nDomain: %s\n' "$ENV_ID" "$DOMAIN"
    exit 0
fi

MNEMONIC="$1"
shift
# These overrides can silently disagree with the selected environment or signer.
if [[ -n "${DOTNS_RPC:-}" || -n "${DOTNS_KEY_URI:-}" || -n "${PAD_ENV_FILE:-}" || -n "${BULLETIN_RPC:-}" || -n "${IPFS_CID:-}" ]]; then
    echo 'Unset DOTNS_RPC, DOTNS_KEY_URI, PAD_ENV_FILE, BULLETIN_RPC, and IPFS_CID before deploying.' >&2
    exit 1
fi
# Forward only options that cannot change the selected network or signer.
EXTRA_ARGS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --tag)
            [[ $# -ge 2 && -n "$2" && "$2" != --* ]] || { echo '--tag requires a value.' >&2; exit 1; }
            EXTRA_ARGS+=("$1" "$2")
            shift 2 ;;
        --tag=*)
            [[ -n "${1#--tag=}" ]] || { echo '--tag requires a value.' >&2; exit 1; }
            EXTRA_ARGS+=("--tag" "${1#--tag=}")
            shift ;;
        --js-merkle)
            EXTRA_ARGS+=("$1")
            shift ;;
        *) echo 'Only --tag and --js-merkle may be passed through.' >&2; exit 1 ;;
    esac
done

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
FRONTEND_DIST="$ROOT/src/apps/frontend/dist"
cd "$ROOT"

if [[ "${SKIP_APP_DEPLOY_INSTALL:-0}" != "1" ]]; then
    npm install -g @parity/polkadot-app-deploy@0.16.1
fi
if [[ "$(polkadot-app-deploy --version)" != "polkadot-app-deploy v0.16.1" ]]; then
    echo 'polkadot-app-deploy 0.16.1 is required.' >&2
    exit 1
fi

pnpm turbo build --filter=@parity/cdm-frontend
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192"

# Keep the direct --mnemonic signer path. The former --suri path could
# prompt for phone confirmation after upload and abort when CI stdin closed.
polkadot-app-deploy \
    --env "$ENV_ID" \
    --mnemonic "$MNEMONIC" \
    "$FRONTEND_DIST" \
    "$DOMAIN" \
    ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"}
