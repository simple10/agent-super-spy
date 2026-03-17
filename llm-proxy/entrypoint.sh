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

cp "$CERT_PATH" /usr/local/share/ca-certificates/mitmproxy-ca.crt
update-ca-certificates
export NODE_EXTRA_CA_CERTS="$CERT_PATH"

# iptables: redirect outbound HTTP/HTTPS to mitmproxy transparent proxy (port 8085)
# All processes in this container run as root (UID 0); the UID 1000 skip is a safety
# net for any future non-root process that should bypass interception.
echo "==> Setting up iptables rules..."
iptables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
ip6tables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
ip6tables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
ip6tables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
echo "==> iptables configured."

echo "==> Starting LLM proxy..."
exec bun run app/server.ts
