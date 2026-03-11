# LLM Observability Stack

A local, all-in-one LLM observability stack that combines [Opik](https://github.com/comet-ml/opik) for trace/span logging, [mitmproxy](https://mitmproxy.org/) for raw HTTP traffic inspection, and a generic LLM proxy that works with any provider.

Point your agents, SDKs, or tools at the LLM proxy and get full visibility into every API call.

## What's Included

**Default stack (always running):**
- **llm-proxy** — Generic LLM API reverse proxy with path-based routing, API key management, and automatic Opik trace logging
- **mitmproxy** — Transparent HTTPS proxy with web UI for raw traffic inspection
- **Opik** — Trace/span visualization and analysis UI

**Optional (via profiles):**
- **claude** — Claude Agent SDK chat UI (`chat` profile)
- **claude-api** — Anthropic API proxy with caching (`api` profile)
- **claude-code** — Claude Code CLI container (`cli` profile)

## Quick Start

```bash
# 1. Interactive setup (generates .env and keys.jsonc)
./setup.sh

# 2. Start everything
./start.sh

# 3. Open the UIs
#    Opik:      http://localhost:5173
#    mitmproxy: http://localhost:8081/?token=mitmpass
```

## How It Works

```text
Your agents / SDKs / tools
        |
        |  ANTHROPIC_BASE_URL=http://localhost:4000/anthropic
        |  OPENAI_BASE_URL=http://localhost:4000/openai
        |  http://localhost:4000/<any-hostname>/path
        |
        v
+- llm-proxy-net ------------------------------------------------------+
|                                                                       |
|  +-------------+    +-----------+    +------------------+             |
|  |  llm-proxy  |--->| mitmproxy |--->| upstream APIs    |             |
|  |  :4000      |    | :8081 UI  |    | anthropic, openai|             |
|  |  key swap + |    |           |    | openrouter, etc. |             |
|  |  opik log   |    +-----------+    +------------------+             |
|  +------+------+                                                      |
|         | traces                                                      |
|         v                                                             |
|  +---------------------------------------------+                     |
|  |  Opik                                        |                     |
|  |  :5173 UI  - trace/span visualization        |                     |
|  +---------------------------------------------+                     |
+-----------------------------------------------------------------------+
```

## LLM Proxy Routing

The proxy uses path-based routing. Set your SDK's base URL to route through the proxy:

| Provider | Base URL | Example |
|----------|----------|---------|
| Anthropic | `http://localhost:4000/anthropic` | `/anthropic/v1/messages` |
| OpenAI | `http://localhost:4000/openai` | `/openai/v1/chat/completions` |
| Any hostname | `http://localhost:4000/<hostname>` | `/api.openrouter.com/v1/messages` |

**Generic routing:** If the first path segment contains a `.`, it's treated as a hostname and forwarded to `https://<hostname>/remaining/path`.

## API Key Management

The proxy supports transparent API key swapping via `keys.jsonc`:

```jsonc
{
  "my-local-key": {
    "anthropic": "sk-ant-real-key...",
    "openai": "sk-real-key...",
    "api.openrouter.com": "sk-or-real-key..."
  }
}
```

**How it works:**
1. Your SDK sends requests with `x-api-key: my-local-key` (or `Authorization: Bearer my-local-key`)
2. The proxy looks up `my-local-key` in `keys.jsonc`
3. Finds the real key for the target provider
4. Swaps it before forwarding to the upstream API

If the key isn't found in `keys.jsonc`, it's passed through as-is (assumed to be a real key).

Reload keys without restarting: `docker kill --signal=HUP <llm-proxy-container>`

## Connecting Other Projects

Add the shared network to your project's `docker-compose.yml`:

```yaml
networks:
  llm-proxy-net:
    name: llm-proxy-net    # or your configured NETWORK_NAME
    external: true

services:
  my-agent:
    networks:
      - default
      - llm-proxy-net
    environment:
      ANTHROPIC_BASE_URL: http://llm-proxy:4000/anthropic
```

From the shared network, these hostnames are available:
- `llm-proxy:4000` — LLM proxy
- `mitmproxy-ui:8081` — mitmproxy web UI
- `opik-backend:8080` — Opik API
- `opik-frontend:5173` — Opik UI

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `COMPOSE_PROJECT_NAME` | `llm-stack` | Docker compose project name |
| `NETWORK_NAME` | `llm-proxy-net` | Shared Docker network name |
| `LLM_PROXY_PORT` | `4000` | LLM proxy host port |
| `OPIK_PROJECT_NAME` | `llm-proxy` | Opik project name for traces |
| `MITMPROXY_UI_PORT` | `8081` | mitmproxy web UI host port |
| `MITMPROXY_WEB_PASSWORD` | `mitmpass` | mitmproxy web UI password |
| `COMPOSE_PROFILES` | — | Optional services: `chat`, `api`, `cli` |
| `ANTHROPIC_API_KEY` | — | For optional Claude services |

## Stopping

```bash
./stop.sh          # Stop all services, keep network
./stop.sh --clean  # Stop all services and remove network
```
