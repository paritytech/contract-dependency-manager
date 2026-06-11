#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: src/lib/scripts/deploy-frontend.sh <mnemonic> [polkadot-app-deploy args...]

Builds the CDM frontend and deploys it to contracts.dot with polkadot-app-deploy.

Examples:
  src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI"
  src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI" --tag frontend

Environment:
  APP_DEPLOY_ENV           Target polkadot-app-deploy env. Default: paseo-next-v2
                           Run `polkadot-app-deploy --list-environments` for valid ids.
  SKIP_APP_DEPLOY_INSTALL  Set to 1 to skip npm install -g @parity/polkadot-app-deploy
EOF
}

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 1
fi

MNEMONIC="$1"
shift

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
FRONTEND_DIST="$ROOT/src/apps/frontend/dist"
DOMAIN="contracts.dot"
ENV_ID="${APP_DEPLOY_ENV:-paseo-next-v2}"

cd "$ROOT"

if [[ "${SKIP_APP_DEPLOY_INSTALL:-0}" != "1" ]]; then
    npm install -g @parity/polkadot-app-deploy@latest
fi

pnpm turbo build --filter=@parity/cdm-frontend

export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192"

polkadot-app-deploy \
    --env "$ENV_ID" \
    --mnemonic "$MNEMONIC" \
    "$FRONTEND_DIST" \
    "$DOMAIN" \
    "$@"
