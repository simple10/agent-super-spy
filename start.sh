#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Load .env ──
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
else
  echo "No .env file found. Run ./setup.sh first, or copy .env.example to .env"
  exit 1
fi

NETWORK_NAME="${NETWORK_NAME:-llm-proxy-net}"
OPIK_DIR="$SCRIPT_DIR/opik"
OPIK_REPO="https://github.com/comet-ml/opik.git"

echo "╔═══════════════════════════════════════════╗"
echo "║   LLM Observability Stack — Starting      ║"
echo "╚═══════════════════════════════════════════╝"
echo ""

# ── Ensure data directories exist ──
mkdir -p data/claude data/sdk-proxy

# ── Ensure keys.jsonc exists ──
if [[ ! -f keys.jsonc ]]; then
  if [[ -f keys.jsonc.example ]]; then
    cp keys.jsonc.example keys.jsonc
    echo "==> Copied keys.jsonc.example to keys.jsonc (edit to add your keys)"
  else
    echo '{}' > keys.jsonc
    echo "==> Created empty keys.jsonc"
  fi
fi

# ── Clone or update Opik ──
if [[ -d "$OPIK_DIR/.git" ]]; then
  echo "==> Updating Opik..."
  git -C "$OPIK_DIR" pull --ff-only 2>/dev/null || echo "    Warning: could not update (you may have local changes)"
else
  echo "==> Cloning Opik..."
  git clone --depth 1 "$OPIK_REPO" "$OPIK_DIR"
fi

# ── Create shared Docker network ──
echo "==> Creating network ${NETWORK_NAME}..."
docker network create "$NETWORK_NAME" 2>/dev/null || true

# ── Start Opik ──
echo "==> Starting Opik..."
docker compose \
  -p opik \
  -f "$OPIK_DIR/deployment/docker-compose/docker-compose.yaml" \
  -f "$SCRIPT_DIR/opik-network.yml" \
  --profile opik \
  up -d

# ── Helper: wait for a compose service to be healthy ──
OPIK_COMPOSE="docker compose -p opik -f $OPIK_DIR/deployment/docker-compose/docker-compose.yaml -f $SCRIPT_DIR/opik-network.yml --profile opik"

wait_healthy() {
  local service=$1
  local timeout=${2:-120}
  local elapsed=0
  local container_id

  container_id=$($OPIK_COMPOSE ps -q "$service" 2>/dev/null)
  if [[ -z "$container_id" ]]; then
    echo "    WARNING: service $service not found"
    return
  fi

  echo -n "    $service..."
  until docker inspect -f '{{.State.Health.Status}}' "$container_id" 2>/dev/null | grep -q healthy; do
    sleep 3
    elapsed=$((elapsed + 3))
    if [[ "$elapsed" -ge "$timeout" ]]; then
      echo " TIMEOUT (${timeout}s, continuing anyway)"
      return
    fi
  done
  echo " ready"
}

echo "==> Waiting for Opik services..."
wait_healthy backend 180
wait_healthy frontend 60

# ── Start proxy stack ──
echo "==> Starting proxy stack..."
docker compose up -d --build

echo ""
echo "==> Stack is running!"
echo ""
echo "  LLM Proxy:    http://localhost:${LLM_PROXY_PORT:-4000}"
echo "  mitmproxy UI: http://localhost:${MITMPROXY_UI_PORT:-8081}"
echo "  Opik UI:      http://localhost:5173"
ACTIVE_PROFILES=",${COMPOSE_PROFILES:-},"
if [[ "$ACTIVE_PROFILES" == *",claude-chat,"* ]]; then
  echo "  Claude Chat:   http://localhost:3000"
fi
if [[ "$ACTIVE_PROFILES" == *",claude-proxy,"* ]]; then
  echo "  Claude Proxy:  http://localhost:4100"
fi
echo ""
echo "  Configure your SDKs:"
echo "    ANTHROPIC_BASE_URL=http://localhost:${LLM_PROXY_PORT:-4000}/anthropic"
echo "    OPENAI_BASE_URL=http://localhost:${LLM_PROXY_PORT:-4000}/openai"
echo "  Or from other docker-compose projects using the same network:"
echo "    ANTHROPIC_BASE_URL=http://llm-proxy:${LLM_PROXY_PORT:-4000}/anthropic"
echo "    OPENAI_BASE_URL=http://llm-proxy:${LLM_PROXY_PORT:-4000}/openai"
