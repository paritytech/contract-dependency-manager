#!/usr/bin/env bash
set -euo pipefail

usage() {
    cat <<'EOF'
Usage: src/lib/scripts/deploy-frontend.sh <suri> [bulletin-deploy args...]

Builds the CDM frontend and deploys it to contracts.dot with bulletin-deploy.

Examples:
  src/lib/scripts/deploy-frontend.sh '//Alice'
  src/lib/scripts/deploy-frontend.sh "$CDM_DEPLOY_SURI" --tag frontend

Environment:
  BULLETIN_DEPLOY_ENV       Target bulletin-deploy env. Default: paseo-next-v2
  SKIP_BULLETIN_INSTALL    Set to 1 to skip npm install -g bulletin-deploy@latest
EOF
}

if [[ $# -lt 1 || "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
    usage
    exit 1
fi

SURI="$1"
shift

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/../../.." && pwd)"
FRONTEND_DIST="$ROOT/src/apps/frontend/dist"
DOMAIN="contracts.dot"
ENV_ID="${BULLETIN_DEPLOY_ENV:-paseo-next-v2}"

cd "$ROOT"

if [[ "${SKIP_BULLETIN_INSTALL:-0}" != "1" ]]; then
    npm install -g bulletin-deploy@latest
fi

pnpm turbo build --filter=@parity/cdm-frontend

export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--max-old-space-size=8192"

bulletin-deploy \
    --env "$ENV_ID" \
    --suri "$SURI" \
    "$FRONTEND_DIST" \
    "$DOMAIN" \
    "$@"
