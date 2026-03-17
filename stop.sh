#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

NETWORK_NAME="${NETWORK_NAME:-llm-proxy-net}"
OPIK_DIR="$SCRIPT_DIR/opik"

csv_has_value() {
  local csv
  csv=",$(echo "${1:-}" | tr -d '[:space:]'),"
  [[ "$csv" == *",$2,"* ]]
}

OPIK_ENABLED=false
if csv_has_value "$COMPOSE_PROFILES" "opik" || csv_has_value "${TRACE_EXPORTERS:-opik}" "opik"; then
  OPIK_ENABLED=true
fi

echo "==> Stopping proxy stack..."
docker compose -p "${COMPOSE_PROJECT_NAME:-llm-stack}" down

if [[ "$OPIK_ENABLED" == true && -d "$OPIK_DIR/deployment/docker-compose" ]]; then
  echo "==> Stopping Opik..."
  docker compose \
    -p opik \
    -f "$OPIK_DIR/deployment/docker-compose/docker-compose.yaml" \
    -f "$SCRIPT_DIR/opik-network.yml" \
    --profile opik \
    down
fi

# Optionally remove the shared network
if [[ "${1:-}" == "--clean" ]]; then
  echo "==> Removing network ${NETWORK_NAME}..."
  docker network rm "$NETWORK_NAME" 2>/dev/null || true
  echo "==> Clean shutdown complete."
else
  echo "==> Stopped. Network ${NETWORK_NAME} preserved (use --clean to remove)."
fi
