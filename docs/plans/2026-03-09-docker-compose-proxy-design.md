# Docker Compose: Claude SDK + mitmproxy

## Purpose

Debug all network traffic from the Claude Agent SDK using a mitmproxy sidecar. The proxy template is reusable; the Claude container is the specific debug target.

## Architecture

Shared network namespace (`network_mode: "service:proxy"`) — same pattern as Istio sidecars. Both containers share one network stack so `iptables -j REDIRECT` works and mitmproxy can read `SO_ORIGINAL_DST` for transparent mode.

```
┌───────────────────────────────────────────────────┐
│  Shared Network Namespace                         │
│                                                   │
│  ┌──────────────────┐   ┌──────────────────────┐ │
│  │    mitmproxy      │   │    claude (bun)       │ │
│  │    UID 1000       │   │    UID 0 (root)       │ │
│  │                   │   │                       │ │
│  │ :8080 regular     │◄──│ HTTPS_PROXY (SDK)     │ │
│  │ :8085 transparent │◄──│ iptables REDIRECT     │ │
│  │ :8081 web UI      │   │   (stray traffic)     │ │
│  └──────────────────┘   └──────────────────────┘ │
│                                                   │
│  Host-exposed: 8081 (web UI)                      │
└───────────────────────────────────────────────────┘
```

## Traffic Flow

1. **Proxy-aware traffic** (SDK honoring `HTTPS_PROXY`): App → localhost:8080 → mitmproxy regular mode → full HTTPS decryption + logging → destination
2. **Stray traffic** (anything ignoring proxy env): iptables catches outbound 80/443 → REDIRECT to localhost:8085 → mitmproxy transparent mode → HTTPS decryption + logging → destination

## iptables Rules

```bash
# Skip mitmproxy's own outbound traffic (UID 1000) to avoid loops
iptables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
# Redirect stray HTTP/HTTPS to transparent proxy port
iptables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
```

## CA Cert Flow

- mitmproxy generates CA at `~/.mitmproxy/mitmproxy-ca-cert.pem` on first start
- Shared via Docker volume `mitmproxy-certs`
- Claude container entrypoint waits for cert, installs to system trust store, sets `NODE_EXTRA_CA_CERTS`

## File Structure

```
claude-sdk-spy/
├── docker-compose.yml
├── .env                        # ANTHROPIC_API_KEY
├── proxy/
│   └── Dockerfile
├── claude/
│   ├── Dockerfile
│   └── entrypoint.sh
└── app/
    ├── package.json
    ├── tsconfig.json
    └── index.ts
```

## Key Decisions

- **Shared network namespace** over separate networks: required for iptables REDIRECT + SO_ORIGINAL_DST
- **UID-based iptables filtering**: UID 1000 (mitmproxy) is exempted to prevent redirect loops
- **Dual mitmproxy modes**: regular@8080 for explicit proxy, transparent@8085 for iptables fallback
- **mitmweb** over mitmdump: provides the web UI on 8081 while still logging to console
- **Root in claude container**: required for iptables setup; acceptable for a debug tool
