#!/bin/bash
set -euo pipefail

# --- Proxy/TLS setup (same as claude container) ---
CERT_PATH="/certs/mitmproxy-ca-cert.pem"
MAX_WAIT=30

echo "==> Waiting for mitmproxy CA cert..."
elapsed=0
while [ ! -f "$CERT_PATH" ]; do
  sleep 1
  elapsed=$((elapsed + 1))
  if [ "$elapsed" -ge "$MAX_WAIT" ]; then
    echo "ERROR: mitmproxy CA cert not found after ${MAX_WAIT}s"
    exit 1
  fi
done
echo "==> CA cert found."

cp "$CERT_PATH" /usr/local/share/ca-certificates/mitmproxy-ca.crt
update-ca-certificates
export NODE_EXTRA_CA_CERTS="$CERT_PATH"

# iptables: redirect stray HTTPS to transparent proxy
echo "==> Setting up iptables rules..."
iptables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
ip6tables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
ip6tables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
ip6tables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
echo "==> iptables configured."

# --- Credentials ---
CREDS_PATH="/credentials/.credentials.json"
if [ -f "$CREDS_PATH" ]; then
  echo "==> Using credentials.json for authentication (via CLAUDE_CONFIG_DIR)"
  export CLAUDE_CONFIG_DIR="/credentials"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "==> Using ANTHROPIC_API_KEY for authentication"
else
  echo "ERROR: No credentials.json or ANTHROPIC_API_KEY provided"
  exit 1
fi

# --- Install dependencies ---
echo "==> Installing dependencies..."
cd /capture
bun install

# --- Step 1: Capture SDK request template ---
echo "==> Running SDK capture..."

export ANTHROPIC_BASE_URL="http://localhost:9999"

bun run intercept-server.ts &
INTERCEPT_PID=$!
sleep 1

bun run capture.ts || true
sleep 1

kill $INTERCEPT_PID 2>/dev/null || true
unset ANTHROPIC_BASE_URL

if [ -f /api-debug/api.json ]; then
  echo "==> Captured API request template."
else
  echo "ERROR: Failed to capture API request template"
  exit 1
fi

# --- Step 2: Start API proxy server ---
echo "==> Starting API server..."
exec bun run api-server.ts
