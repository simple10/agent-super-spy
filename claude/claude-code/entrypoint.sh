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

# Set NODE_EXTRA_CA_CERTS for node
export NODE_EXTRA_CA_CERTS="$CERT_PATH"

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

exec claude "$@"
