#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colors ──
if [[ -t 1 ]]; then
  BOLD='\033[1m'
  DIM='\033[2m'
  CYAN='\033[36m'
  GREEN='\033[32m'
  YELLOW='\033[33m'
  RED='\033[31m'
  RESET='\033[0m'
else
  BOLD='' DIM='' CYAN='' GREEN='' YELLOW='' RED='' RESET=''
fi

# ── Load .env ──
if [[ -f .env ]]; then
  set -a
  source .env
  set +a
else
  echo -e "${RED}No .env file found. Run ./setup.sh first, or copy .env.example to .env${RESET}"
  exit 1
fi

NETWORK_NAME="${NETWORK_NAME:-llm-proxy-net}"
OPIK_DIR="$SCRIPT_DIR/opik"
OPIK_REPO="https://github.com/comet-ml/opik.git"

csv_has_value() {
  local csv
  csv=",$(echo "${1:-}" | tr -d '[:space:]'),"
  [[ "$csv" == *",$2,"* ]]
}

OPIK_ENABLED=false
if csv_has_value "$COMPOSE_PROFILES" "opik" || csv_has_value "${TRACE_EXPORTERS:-opik}" "opik"; then
  OPIK_ENABLED=true
fi

PHOENIX_ENABLED=false
if csv_has_value "$COMPOSE_PROFILES" "phoenix"; then
  PHOENIX_ENABLED=true
fi

echo -e "${BOLD}${CYAN}╔═══════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${CYAN}║   LLM Observability Stack — Starting      ║${RESET}"
echo -e "${BOLD}${CYAN}╚═══════════════════════════════════════════╝${RESET}"
echo ""

# ── Build or just start? ──
BUILD_FLAG=""
if [[ "${1:-}" == "--build" ]]; then
  BUILD_FLAG="--build"
  echo -e "${DIM}Build requested via --build flag${RESET}"
elif [[ "${1:-}" == "--no-build" ]]; then
  BUILD_FLAG=""
  echo -e "${DIM}Skipping build via --no-build flag${RESET}"
else
  echo -e "${YELLOW}Build Docker images?${RESET}"
  echo -e "  ${DIM}(b)uild    — rebuild images before starting${RESET}"
  echo -e "  ${DIM}(s)tart    — start with existing images (faster)${RESET}"
  echo ""
  read -r -p "$(echo -e "${BOLD}[b/S]:${RESET} ")" choice
  case "$choice" in
    b|B|build|Build) BUILD_FLAG="--build" ;;
    *)               BUILD_FLAG="" ;;
  esac
  echo ""
fi

# ── Ensure data directories exist ──
mkdir -p data/claude data/sdk-proxy data/phoenix

# ── Ensure keys.jsonc exists ──
if [[ ! -f keys.jsonc ]]; then
  if [[ -f keys.jsonc.example ]]; then
    cp keys.jsonc.example keys.jsonc
    echo -e "${YELLOW}==> Copied keys.jsonc.example to keys.jsonc (edit to add your keys)${RESET}"
  else
    echo '{}' > keys.jsonc
    echo -e "${YELLOW}==> Created empty keys.jsonc${RESET}"
  fi
fi

# ── Create shared Docker network ──
echo -e "${CYAN}==> Creating network ${NETWORK_NAME}...${RESET}"
docker network create "$NETWORK_NAME" 2>/dev/null || true

# ── Helper: wait for a compose service to be healthy ──
OPIK_COMPOSE="docker compose -p opik -f $OPIK_DIR/deployment/docker-compose/docker-compose.yaml -f $SCRIPT_DIR/opik-network.yml --profile opik"

wait_healthy() {
  local service=$1
  local timeout=${2:-120}
  local elapsed=0
  local container_id

  container_id=$($OPIK_COMPOSE ps -q "$service" 2>/dev/null)
  if [[ -z "$container_id" ]]; then
    echo -e "    ${YELLOW}WARNING: service $service not found${RESET}"
    return
  fi

  echo -n -e "    ${DIM}$service...${RESET}"
  until docker inspect -f '{{.State.Health.Status}}' "$container_id" 2>/dev/null | grep -q healthy; do
    sleep 3
    elapsed=$((elapsed + 3))
    if [[ "$elapsed" -ge "$timeout" ]]; then
      echo -e " ${RED}TIMEOUT (${timeout}s, continuing anyway)${RESET}"
      return
    fi
  done
  echo -e " ${GREEN}ready${RESET}"
}

if [[ "$OPIK_ENABLED" == true ]]; then
  # ── Clone or update Opik ──
  if [[ -d "$OPIK_DIR/.git" ]]; then
    echo -e "${CYAN}==> Updating Opik...${RESET}"
    git -C "$OPIK_DIR" pull --ff-only 2>/dev/null || echo -e "    ${YELLOW}Warning: could not update (you may have local changes)${RESET}"
  else
    echo -e "${CYAN}==> Cloning Opik...${RESET}"
    git clone --depth 1 "$OPIK_REPO" "$OPIK_DIR"
  fi

  # ── Start Opik ──
  echo -e "${CYAN}==> Starting Opik...${RESET}"
  docker compose \
    -p opik \
    -f "$OPIK_DIR/deployment/docker-compose/docker-compose.yaml" \
    -f "$SCRIPT_DIR/opik-network.yml" \
    --profile opik \
    up -d

  echo -e "${CYAN}==> Waiting for Opik services...${RESET}"
  wait_healthy backend 180
  wait_healthy frontend 60
else
  echo -e "${DIM}Skipping Opik startup (not enabled)${RESET}"
fi

# ── Start proxy stack ──
echo -e "${CYAN}==> Starting proxy stack...${RESET}"
docker compose up -d $BUILD_FLAG

echo ""
echo -e "${BOLD}${GREEN}==> Stack is running!${RESET}"
echo ""
echo -e "  ${BOLD}mitmproxy UI:${RESET} ${YELLOW}http://localhost:${MITMPROXY_UI_PORT:-8081}?token=${MITMPROXY_WEB_PASSWORD:-mitmpass}${RESET}  ${DIM}(password: ${MITMPROXY_WEB_PASSWORD:-mitmpass})${RESET}"
if [[ "$OPIK_ENABLED" == true ]]; then
  echo -e "  ${BOLD}Opik UI:${RESET}      ${YELLOW}http://localhost:5173${RESET}"
fi
if [[ "$PHOENIX_ENABLED" == true ]]; then
  echo -e "  ${BOLD}Phoenix UI:${RESET}   ${YELLOW}http://localhost:6006${RESET}"
fi
if csv_has_value "$COMPOSE_PROFILES" "claude-chat"; then
  echo -e "  ${BOLD}Claude Chat:${RESET}  ${YELLOW}http://localhost:3000${RESET}"
fi
echo ""
echo -e "  ${BOLD}LLM Proxy:${RESET}    http://localhost:${LLM_PROXY_PORT:-4000}"
if csv_has_value "$COMPOSE_PROFILES" "claude-proxy"; then
  echo -e "  ${BOLD}Claude Proxy:${RESET} http://localhost:4100"
fi
echo ""
echo -e "  ${BOLD}Configure your SDKs:${RESET}"
echo -e "    ${DIM}ANTHROPIC_BASE_URL=${RESET}http://localhost:${LLM_PROXY_PORT:-4000}/anthropic"
echo -e "    ${DIM}OPENAI_BASE_URL=${RESET}http://localhost:${LLM_PROXY_PORT:-4000}/openai"
echo ""
echo -e "  ${BOLD}From other docker-compose projects${RESET} ${DIM}(network: ${NETWORK_NAME:-llm-proxy-net}):${RESET}"
echo -e "    ${DIM}ANTHROPIC_BASE_URL=${RESET}http://llm-proxy:${LLM_PROXY_PORT:-4000}/anthropic"
echo -e "    ${DIM}OPENAI_BASE_URL=${RESET}http://llm-proxy:${LLM_PROXY_PORT:-4000}/openai"
echo ""
