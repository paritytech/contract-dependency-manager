#!/usr/bin/env bash
# End-to-end validation of the ContractRegistry contract against a real chain.
#
# Spins a transient revive-dev-node, deploys the registry to it, runs the
# round-trip test against every public method, and tears the node down on
# exit (including on ^C). Designed for local development and CI.
#
# Requires:
#   - revive-dev-node binary on $PATH (build via:
#       cargo install --git https://github.com/paritytech/polkadot-sdk --bin revive-dev-node)
#   - bun + pnpm
#   - Node 22+ (vitest's dep tree needs it; bun-runtime scripts are fine on 20)
#
# Usage:
#   src/lib/scripts/run-registry-e2e.sh                # spin a fresh node, run test
#   PORT=9955 src/lib/scripts/run-registry-e2e.sh      # override port
#   EXTERNAL_ASSETHUB_URL=ws://other:9944 src/lib/scripts/run-registry-e2e.sh
#     # don't start a node — use an existing one (CI mode)

set -euo pipefail

PORT="${PORT:-9944}"
ASSETHUB_URL="${EXTERNAL_ASSETHUB_URL:-ws://127.0.0.1:$PORT}"
SPAWN_NODE=1
if [[ -n "${EXTERNAL_ASSETHUB_URL:-}" ]]; then
    SPAWN_NODE=0
fi

ROOT_DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
LOG_FILE="$(mktemp -t cdm-e2e-revive-node.XXXXXX.log)"
PID_FILE="$(mktemp -t cdm-e2e-revive-node.XXXXXX.pid)"

cleanup() {
    if [[ "$SPAWN_NODE" == "1" && -s "$PID_FILE" ]]; then
        local pid
        pid="$(cat "$PID_FILE")"
        if kill -0 "$pid" 2>/dev/null; then
            kill "$pid" 2>/dev/null || true
            # Give it a moment to shutdown cleanly before SIGKILL
            for _ in $(seq 1 10); do
                kill -0 "$pid" 2>/dev/null || break
                sleep 0.3
            done
            kill -9 "$pid" 2>/dev/null || true
        fi
    fi
    rm -f "$PID_FILE"
    # Keep the log on failure for postmortem; remove on success
    if [[ "${EXIT_OK:-0}" == "1" ]]; then
        rm -f "$LOG_FILE"
    else
        echo "  (node log retained: $LOG_FILE)" >&2
    fi
}
trap cleanup EXIT INT TERM

# --- 1. Ensure the binary the test will exercise has been built.
if [[ ! -f "$ROOT_DIR/target/release/contract-registry.polkavm" ]]; then
    echo "Building contract-registry..."
    (cd "$ROOT_DIR" && make build-registry >/dev/null)
fi

# --- 2. Spin a fresh node (unless one is provided externally).
if [[ "$SPAWN_NODE" == "1" ]]; then
    if ! command -v revive-dev-node >/dev/null 2>&1; then
        echo "Error: revive-dev-node not found on \$PATH." >&2
        echo "Build it:" >&2
        echo "  cargo install --git https://github.com/paritytech/polkadot-sdk --bin revive-dev-node" >&2
        exit 1
    fi

    echo "Starting revive-dev-node on port $PORT..."
    revive-dev-node \
        --dev \
        --rpc-port "$PORT" \
        --no-prometheus \
        --log error \
        >"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"

    # Wait for RPC readiness
    READY=0
    for _ in $(seq 1 60); do
        if curl -s -m 2 \
            -H "Content-Type: application/json" \
            -d '{"jsonrpc":"2.0","id":1,"method":"system_chain","params":[]}' \
            "http://127.0.0.1:$PORT" 2>/dev/null | grep -q result; then
            READY=1
            break
        fi
        sleep 1
    done
    if [[ "$READY" != "1" ]]; then
        echo "Error: revive-dev-node didn't accept RPC on port $PORT within 60s." >&2
        echo "Log: $LOG_FILE" >&2
        exit 1
    fi
    echo "Node ready at $ASSETHUB_URL"
fi

# --- 3. Build the @dotdm/contracts dist/ so bun can resolve it from scripts.
echo "Building @dotdm/contracts dist/..."
(cd "$ROOT_DIR" && pnpm --filter @dotdm/contracts build >/dev/null)

# --- 4. Deploy the registry, capture its address.
echo "Deploying registry..."
DEPLOY_OUT="$(cd "$ROOT_DIR" && bun run src/lib/scripts/deploy-registry.ts --assethub-url "$ASSETHUB_URL" 2>&1)"
REGISTRY_ADDR="$(echo "$DEPLOY_OUT" | grep '^CONTRACTS_REGISTRY_ADDR=' | head -1 | cut -d= -f2 | tr -d '[:space:]')"
if [[ -z "$REGISTRY_ADDR" ]]; then
    echo "Error: deploy-registry didn't print CONTRACTS_REGISTRY_ADDR" >&2
    echo "Output:" >&2
    echo "$DEPLOY_OUT" >&2
    exit 1
fi
echo "Registry at $REGISTRY_ADDR"

# --- 5. Run the round-trip test against the live registry.
echo "Running round-trip test..."
(cd "$ROOT_DIR" && bun run src/lib/scripts/test-registry-roundtrip.ts \
    --assethub-url "$ASSETHUB_URL" \
    --registry "$REGISTRY_ADDR")

EXIT_OK=1
echo ""
echo "Registry e2e: PASS"
