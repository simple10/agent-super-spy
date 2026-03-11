# Docker Compose: Claude SDK + mitmproxy Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a docker-compose project with a Claude Agent SDK container and mitmproxy sidecar that captures all HTTP/HTTPS traffic via explicit proxy + iptables fallback.

**Architecture:** Two containers sharing a network namespace. mitmproxy runs in dual mode (regular@8080 + transparent@8085) with web UI on 8081. The Claude container sets HTTPS_PROXY for SDK traffic and uses iptables REDIRECT for stray traffic. UID-based filtering prevents redirect loops.

**Tech Stack:** Docker Compose, mitmproxy, Bun, TypeScript, @anthropic-ai/claude-agent-sdk, iptables

---

### Task 1: Create proxy Dockerfile

**Files:**
- Create: `proxy/Dockerfile`

**Step 1: Write the Dockerfile**

```dockerfile
FROM mitmproxy/mitmproxy:latest

# Generate CA cert on first run, then start mitmweb in dual mode
# mitmproxy runs as UID 1000 by default in this image
CMD ["mitmweb", \
     "--mode", "regular@8080", \
     "--mode", "transparent@8085", \
     "--web-host", "0.0.0.0", \
     "--web-port", "8081", \
     "--set", "stream_large_bodies=1"]
```

**Step 2: Verify the image builds**

Run: `docker build -t claude-sdk-spy-proxy ./proxy`
Expected: Successfully built

**Step 3: Commit**

```bash
git add proxy/Dockerfile
git commit -m "feat: add mitmproxy Dockerfile with dual-mode config"
```

---

### Task 2: Create sample TypeScript app

**Files:**
- Create: `app/package.json`
- Create: `app/tsconfig.json`
- Create: `app/index.ts`

**Step 1: Write package.json**

```json
{
  "name": "claude-sdk-spy-app",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "@anthropic-ai/claude-agent-sdk": "latest"
  }
}
```

**Step 2: Write tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "outDir": "dist"
  },
  "include": ["*.ts"]
}
```

**Step 3: Write index.ts**

A sample script that uses the Claude Agent SDK to make a simple query, proving traffic flows through the proxy.

```typescript
import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  console.log("Starting Claude Agent SDK test...");
  console.log(`HTTPS_PROXY: ${process.env.HTTPS_PROXY ?? "(not set)"}`);
  console.log(`NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS ?? "(not set)"}`);

  for await (const message of query({
    prompt: "Say hello in exactly 5 words.",
    options: {
      maxTurns: 1,
    },
  })) {
    if ("result" in message) {
      console.log("\nAgent result:", message.result);
    }
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
```

**Step 4: Commit**

```bash
git add app/
git commit -m "feat: add sample TypeScript app using Claude Agent SDK"
```

---

### Task 3: Create Claude container Dockerfile and entrypoint

**Files:**
- Create: `claude/Dockerfile`
- Create: `claude/entrypoint.sh`

**Step 1: Write the Dockerfile**

```dockerfile
FROM oven/bun:latest

# Install iptables and CA cert tools (image is Debian-based)
USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends iptables ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
```

**Step 2: Write the entrypoint script**

```bash
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

# Set up iptables: redirect stray HTTP/HTTPS to transparent proxy port
# Skip mitmproxy's own traffic (UID 1000) to avoid redirect loops
echo "==> Setting up iptables rules..."
iptables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
echo "==> iptables configured."

# Install dependencies
echo "==> Installing dependencies..."
cd /app
bun install

# Run the app
echo "==> Running app..."
exec bun run index.ts
```

**Step 3: Verify the image builds**

Run: `docker build -t claude-sdk-spy-claude ./claude`
Expected: Successfully built

**Step 4: Commit**

```bash
git add claude/
git commit -m "feat: add Claude container with iptables and CA cert setup"
```

---

### Task 4: Create docker-compose.yml and .env.example

**Files:**
- Create: `docker-compose.yml`
- Create: `.env.example`
- Create: `.gitignore`

**Step 1: Write docker-compose.yml**

```yaml
services:
  proxy:
    build: ./proxy
    ports:
      - "8081:8081"   # mitmproxy web UI
    volumes:
      - mitmproxy-certs:/home/mitmproxy/.mitmproxy
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:8081/"]
      interval: 2s
      timeout: 5s
      retries: 15

  claude:
    build: ./claude
    network_mode: "service:proxy"
    depends_on:
      proxy:
        condition: service_healthy
    cap_add:
      - NET_ADMIN   # required for iptables
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - HTTP_PROXY=http://localhost:8080
      - HTTPS_PROXY=http://localhost:8080
      - NO_PROXY=localhost,127.0.0.1
    volumes:
      - ./app:/app
      - mitmproxy-certs:/certs:ro

volumes:
  mitmproxy-certs:
```

**Step 2: Write .env.example**

```
ANTHROPIC_API_KEY=your-api-key-here
```

**Step 3: Write .gitignore**

```
.env
node_modules/
```

**Step 4: Commit**

```bash
git add docker-compose.yml .env.example .gitignore
git commit -m "feat: add docker-compose with proxy sidecar and shared network namespace"
```

---

### Task 5: End-to-end verification

**Step 1: Copy .env and set API key**

Run: `cp .env.example .env` then edit `.env` with a real key.

**Step 2: Build and start**

Run: `docker compose up --build`

Expected:
- proxy starts and generates CA cert
- claude container waits for cert, installs it, sets up iptables
- sample app runs and makes API call through proxy
- mitmproxy web UI visible at http://localhost:8081

**Step 3: Verify traffic in web UI**

Open http://localhost:8081 and confirm requests to `api.anthropic.com` are visible with full request/response bodies.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete docker-compose proxy setup for Claude SDK traffic inspection"
```
