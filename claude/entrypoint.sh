#!/bin/bash
set -euo pipefail

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

# Install CA cert system-wide
cp "$CERT_PATH" /usr/local/share/ca-certificates/mitmproxy-ca.crt
update-ca-certificates

# Set NODE_EXTRA_CA_CERTS for bun/node
export NODE_EXTRA_CA_CERTS="$CERT_PATH"

# Credentials: prefer credentials.json over ANTHROPIC_API_KEY
# The CLI expects the file at $CLAUDE_CONFIG_DIR/.credentials.json (dot prefix)
CREDS_PATH="/credentials/.credentials.json"
if [ -f "$CREDS_PATH" ]; then
  echo "==> Using credentials.json for authentication (via CLAUDE_CONFIG_DIR)"
  export CLAUDE_CONFIG_DIR="/credentials"
  unset ANTHROPIC_API_KEY 2>/dev/null || true
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  echo "==> Using ANTHROPIC_API_KEY for authentication"
else
  echo "ERROR: No credentials.json or ANTHROPIC_API_KEY provided"
  exit 1
fi

# Set up iptables: redirect stray HTTP/HTTPS to transparent proxy port
# Skip mitmproxy's own traffic (UID 1000) to avoid redirect loops
echo "==> Setting up iptables rules..."
# IPv4
iptables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
# IPv6
ip6tables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
ip6tables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
ip6tables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
echo "==> iptables configured (IPv4 + IPv6)."

# Install dependencies
echo "==> Installing dependencies..."
cd /app
bun install

# Run the app
echo "==> Running app..."
exec bun run index.ts
