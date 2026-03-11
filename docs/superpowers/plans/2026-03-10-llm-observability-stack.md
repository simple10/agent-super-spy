# LLM Observability Stack Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the project into a general-purpose local LLM observability stack with mitmproxy, a generic LLM proxy that logs to Opik, interactive setup, and orchestration scripts.

**Architecture:** A shared Docker network (`llm-proxy-net`) connects two docker-compose stacks: (1) Opik (cloned and managed by `start.sh`) for trace/span visualization, and (2) the proxy stack containing mitmproxy for raw traffic inspection and llm-proxy for provider-agnostic API proxying with Opik trace logging. The llm-proxy uses path-based routing (`/anthropic/*`, `/openai/*`, `/<hostname>/*`) and a JSONC key config to swap local keys for real provider keys. Optional claude-specific services remain available via compose profiles.

**Tech Stack:** Docker Compose, mitmproxy, Bun, TypeScript, Opik REST API

---

## File Map

**New files:**

```
llm-proxy/
  server.ts            # HTTP server: routing, key swap, forwarding, stream tee
  router.ts            # resolveRoute() - provider detection from URL path
  keys.ts              # loadKeys(), extractCallerAuth(), resolveRealKey()
  opik.ts              # logTrace() - fire-and-forget Opik REST API calls
  router.test.ts       # Unit tests for router
  keys.test.ts         # Unit tests for keys
  package.json         # Minimal (no external deps - Bun built-ins only)
  tsconfig.json
  Dockerfile           # oven/bun + iptables + ca-certificates + curl
  entrypoint.sh        # CA cert, iptables, bun install, start server

keys.jsonc.example     # Example key config showing the format
opik-network.yml       # Docker compose override to attach Opik to shared network
setup.sh               # Interactive .env + keys.jsonc generator
start.sh               # Clone/update Opik, create network, start both stacks
stop.sh                # Stop both stacks, optionally remove network
```

**Modified files:**

```
docker-compose.yml     # Rename proxy→mitmproxy, add llm-proxy, profiles, networks
.env.example           # New variables (NETWORK_NAME, LLM_PROXY_PORT, etc.)
.gitignore             # Add opik/, keys.jsonc
README.md              # Full rewrite for new architecture
```

**Unchanged files (add profiles only):**

```
proxy/Dockerfile       # Unchanged
claude/                # Add profiles: ["chat"]
claude-api/            # Keep profiles: ["api"], change port 4000→4100
claude-code/           # Keep profiles: ["cli"]
app/                   # Unchanged (mounted by claude service)
claude-code.sh         # Unchanged
```

---

## Chunk 1: Foundation

### Task 1: Project setup

**Files:**

- Modify: `.gitignore`
- Create: `keys.jsonc.example`
- Modify: `.env.example`

- [ ] **Step 1: Update .gitignore**

Add entries for the Opik clone directory and sensitive config files.

```gitignore
.DS_Store
.env
credentials.json
node_modules/
bun.lock
api-debug/
.opik
opik/
keys.jsonc
```

- [ ] **Step 2: Create keys.jsonc.example**

```jsonc
{
  // Local API key → real provider keys
  // Clients send the local key to llm-proxy, which swaps it for the real key.
  //
  // Usage: set your SDK's base URL to http://llm-proxy:4000/<provider>
  //   ANTHROPIC_BASE_URL=http://localhost:4000/anthropic
  //   OPENAI_BASE_URL=http://localhost:4000/openai
  //   Or for any provider: http://localhost:4000/api.openrouter.com
  //
  // Then set your SDK's API key to one of the local keys below.

  "my-local-key": {
    "anthropic": "sk-ant-...",
    "openai": "sk-...",
    "api.openrouter.com": "sk-or-..."
  }

  // Add more local keys for different users/agents:
  // "another-key": {
  //   "anthropic": "sk-ant-...",
  //   "openai": "sk-..."
  // }
}
```

- [ ] **Step 3: Update .env.example**

```bash
# ── LLM Observability Stack ──────────────────────────────────────
# Run ./setup.sh to generate this file interactively.

# Docker
COMPOSE_PROJECT_NAME=llm-stack
NETWORK_NAME=llm-proxy-net

# LLM Proxy
LLM_PROXY_PORT=4000
OPIK_PROJECT_NAME=llm-proxy

# mitmproxy
MITMPROXY_UI_PORT=8081
MITMPROXY_WEB_PASSWORD=mitmpass

# Optional services (comma-separated: chat,api,cli)
# COMPOSE_PROFILES=chat,api,cli

# ── Optional: Claude services ────────────────────────────────────
# Required if chat, api, or cli profiles are enabled.
# ANTHROPIC_API_KEY=

# API key for authenticating calls to the claude-api service (port 4100)
# API_SERVER_KEY=
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore keys.jsonc.example .env.example
git commit -m "feat: update project config for LLM observability stack"
```

---

### Task 2: Router module with tests

**Files:**

- Create: `llm-proxy/router.ts`
- Create: `llm-proxy/router.test.ts`
- Create: `llm-proxy/package.json`
- Create: `llm-proxy/tsconfig.json`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "llm-proxy",
  "version": "1.0.0",
  "type": "module"
}
```

- [ ] **Step 2: Create tsconfig.json**

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

- [ ] **Step 3: Write router.test.ts**

```typescript
import { describe, test, expect } from 'bun:test'
import { resolveRoute } from './router'

describe('resolveRoute', () => {
  test('routes anthropic provider', () => {
    expect(resolveRoute('/anthropic/v1/messages')).toEqual({
      provider: 'anthropic',
      upstream: 'https://api.anthropic.com',
      path: '/v1/messages',
    })
  })

  test('routes openai provider', () => {
    expect(resolveRoute('/openai/v1/chat/completions')).toEqual({
      provider: 'openai',
      upstream: 'https://api.openai.com',
      path: '/v1/chat/completions',
    })
  })

  test('routes generic hostname with dot', () => {
    expect(resolveRoute('/api.openrouter.com/v1/messages')).toEqual({
      provider: 'api.openrouter.com',
      upstream: 'https://api.openrouter.com',
      path: '/v1/messages',
    })
  })

  test('routes deeply nested generic path', () => {
    expect(resolveRoute('/api.example.com/v2/some/deep/path')).toEqual({
      provider: 'api.example.com',
      upstream: 'https://api.example.com',
      path: '/v2/some/deep/path',
    })
  })

  test('returns null for unknown provider without dot', () => {
    expect(resolveRoute('/unknown/v1/test')).toBeNull()
  })

  test('returns null for empty path', () => {
    expect(resolveRoute('/')).toBeNull()
  })

  test('handles provider-only path', () => {
    expect(resolveRoute('/anthropic')).toEqual({
      provider: 'anthropic',
      upstream: 'https://api.anthropic.com',
      path: '/',
    })
  })

  test('preserves query-free path segments', () => {
    expect(resolveRoute('/openai/v1/models')).toEqual({
      provider: 'openai',
      upstream: 'https://api.openai.com',
      path: '/v1/models',
    })
  })

  test('is case-sensitive (uppercase returns null)', () => {
    expect(resolveRoute('/Anthropic/v1/messages')).toBeNull()
  })

  test('handles double slashes via filter(Boolean)', () => {
    expect(resolveRoute('//anthropic/v1/messages')).toEqual({
      provider: 'anthropic',
      upstream: 'https://api.anthropic.com',
      path: '/v1/messages',
    })
  })
})
```

- [ ] **Step 4: Run tests — expect failure**

Run: `cd llm-proxy && bun test router.test.ts`
Expected: FAIL — `resolveRoute` not found

- [ ] **Step 5: Write router.ts**

```typescript
const KNOWN_PROVIDERS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
}

export interface Route {
  provider: string
  upstream: string
  path: string
}

export function resolveRoute(pathname: string): Route | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const prefix = segments[0]
  const restPath = segments.length > 1 ? '/' + segments.slice(1).join('/') : '/'

  // Generic URL routing: if prefix contains a dot, treat as hostname
  if (prefix.includes('.')) {
    return { provider: prefix, upstream: `https://${prefix}`, path: restPath }
  }

  // Known provider routing
  const upstream = KNOWN_PROVIDERS[prefix]
  if (upstream) {
    return { provider: prefix, upstream, path: restPath }
  }

  return null
}
```

- [ ] **Step 6: Run tests — expect pass**

Run: `cd llm-proxy && bun test router.test.ts`
Expected: All 10 tests PASS

- [ ] **Step 7: Commit**

```bash
git add llm-proxy/package.json llm-proxy/tsconfig.json llm-proxy/router.ts llm-proxy/router.test.ts
git commit -m "feat(llm-proxy): add URL router with provider and generic hostname support"
```

---

### Task 3: Keys module with tests

**Files:**

- Create: `llm-proxy/keys.ts`
- Create: `llm-proxy/keys.test.ts`

- [ ] **Step 1: Write keys.test.ts**

```typescript
import { describe, test, expect } from 'bun:test'
import { extractCallerAuth, resolveRealKey, loadKeys } from './keys'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('extractCallerAuth', () => {
  test('extracts x-api-key header', () => {
    const headers = new Headers({ 'x-api-key': 'test-key' })
    expect(extractCallerAuth(headers)).toEqual({
      key: 'test-key',
      header: 'x-api-key',
      format: 'plain',
    })
  })

  test('extracts Bearer token from authorization', () => {
    const headers = new Headers({ authorization: 'Bearer my-token' })
    expect(extractCallerAuth(headers)).toEqual({
      key: 'my-token',
      header: 'authorization',
      format: 'bearer',
    })
  })

  test('prefers x-api-key over authorization', () => {
    const headers = new Headers({
      'x-api-key': 'api-key',
      authorization: 'Bearer bearer-key',
    })
    expect(extractCallerAuth(headers)!.key).toBe('api-key')
  })

  test('returns null when no auth headers present', () => {
    const headers = new Headers({ 'content-type': 'application/json' })
    expect(extractCallerAuth(headers)).toBeNull()
  })

  test('returns null for empty x-api-key', () => {
    const headers = new Headers({ 'x-api-key': '' })
    expect(extractCallerAuth(headers)).toBeNull()
  })

  test('returns null for Bearer with no token', () => {
    const headers = new Headers({ authorization: 'Bearer ' })
    expect(extractCallerAuth(headers)).toBeNull()
  })

  test('returns null for non-Bearer authorization', () => {
    const headers = new Headers({ authorization: 'Basic abc123' })
    expect(extractCallerAuth(headers)).toBeNull()
  })
})

describe('resolveRealKey', () => {
  const config = {
    'local-key-1': {
      anthropic: 'real-anthropic-key',
      openai: 'real-openai-key',
    },
    'local-key-2': {
      anthropic: 'another-anthropic-key',
    },
  }

  test('resolves known local key for known provider', () => {
    expect(resolveRealKey('local-key-1', 'anthropic', config)).toEqual({
      realKey: 'real-anthropic-key',
      isLocalKey: true,
    })
  })

  test('returns null realKey when provider not configured for local key', () => {
    expect(resolveRealKey('local-key-2', 'openai', config)).toEqual({
      realKey: null,
      isLocalKey: true,
    })
  })

  test('returns isLocalKey false for unknown key (pass-through)', () => {
    expect(resolveRealKey('unknown-key', 'anthropic', config)).toEqual({
      realKey: null,
      isLocalKey: false,
    })
  })

  test('resolves generic hostname provider', () => {
    const cfg = {
      'my-key': { 'api.openrouter.com': 'real-openrouter-key' },
    }
    expect(resolveRealKey('my-key', 'api.openrouter.com', cfg)).toEqual({
      realKey: 'real-openrouter-key',
      isLocalKey: true,
    })
  })
})

describe('loadKeys', () => {
  test('loads valid JSONC file with comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-test-'))
    const path = join(dir, 'keys.jsonc')
    writeFileSync(
      path,
      `{
      // This is a comment
      "key1": {
        "anthropic": "real-key"
      }
    }`,
    )
    const config = loadKeys(path)
    expect(config).toEqual({ key1: { anthropic: 'real-key' } })
    unlinkSync(path)
  })

  test('handles trailing commas in JSONC', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-test-'))
    const path = join(dir, 'keys.jsonc')
    writeFileSync(
      path,
      `{
      "key1": {
        "anthropic": "a",
        "openai": "b",
      },
    }`,
    )
    const config = loadKeys(path)
    expect(config.key1.anthropic).toBe('a')
    expect(config.key1.openai).toBe('b')
    unlinkSync(path)
  })

  test('returns empty object for missing file', () => {
    expect(loadKeys('/nonexistent/keys.jsonc')).toEqual({})
  })

  test('throws on invalid JSON (not ENOENT)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-test-'))
    const path = join(dir, 'keys.jsonc')
    writeFileSync(path, '{ invalid json }')
    expect(() => loadKeys(path)).toThrow()
    unlinkSync(path)
  })
})
```

- [ ] **Step 2: Run tests — expect failure**

Run: `cd llm-proxy && bun test keys.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write keys.ts**

```typescript
import { readFileSync } from 'fs'

// Key config: { "local-key": { "provider": "real-key", ... }, ... }
export type KeyConfig = Record<string, Record<string, string>>

export function loadKeys(path: string): KeyConfig {
  try {
    const raw = readFileSync(path, 'utf-8')
    // Strip JSONC: single-line comments, multi-line comments, trailing commas.
    // Note: this naive regex will break if string values contain "//".
    // This is acceptable for keys.jsonc which only contains API key strings.
    const stripped = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(stripped)
  } catch (err: any) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

export interface CallerAuth {
  key: string
  header: string
  format: 'plain' | 'bearer'
}

export function extractCallerAuth(headers: Headers): CallerAuth | null {
  const xApiKey = headers.get('x-api-key')
  if (xApiKey) return { key: xApiKey, header: 'x-api-key', format: 'plain' }

  const auth = headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim()
    if (token) return { key: token, header: 'authorization', format: 'bearer' }
  }

  return null
}

export function resolveRealKey(
  callerKey: string,
  provider: string,
  config: KeyConfig,
): { realKey: string | null; isLocalKey: boolean } {
  const entry = config[callerKey]
  if (!entry) return { realKey: null, isLocalKey: false }
  const realKey = entry[provider] ?? null
  return { realKey, isLocalKey: true }
}
```

- [ ] **Step 4: Run tests — expect pass**

Run: `cd llm-proxy && bun test keys.test.ts`
Expected: All 12 tests PASS

- [ ] **Step 5: Commit**

```bash
git add llm-proxy/keys.ts llm-proxy/keys.test.ts
git commit -m "feat(llm-proxy): add JSONC key config loading and auth resolution"
```

---

## Chunk 2: LLM Proxy Service

### Task 4: Opik logging module

**Files:**

- Create: `llm-proxy/opik.ts`

The Opik REST API (local, no auth required):

- `POST /api/v1/private/traces` — create trace (201)
- `POST /api/v1/private/spans` — create span (201)

Key fields for traces: `id`, `project_name`, `name`, `start_time` (required, ISO-8601), `end_time`, `input`, `output`, `metadata`, `tags`

Key fields for spans: `id`, `trace_id` (required), `project_name`, `name`, `type` (enum: `general`/`tool`/`llm`/`guardrail`), `start_time` (required), `end_time`, `input`, `output`, `model`, `provider`, `usage` (`prompt_tokens`/`completion_tokens`/`total_tokens`), `metadata`, `error_info`

- [ ] **Step 1: Write opik.ts**

```typescript
import { randomUUID } from 'crypto'

const OPIK_BASE_URL = process.env.OPIK_BASE_URL || 'http://opik-backend:8080'
const OPIK_PROJECT = process.env.OPIK_PROJECT_NAME || 'llm-proxy'

export interface TraceData {
  provider: string
  method: string
  path: string
  requestBody: any
  responseBody: any
  statusCode: number
  startTime: Date
  endTime: Date
  error?: string
}

export function extractModelAndUsage(
  provider: string,
  requestBody: any,
  responseBody: any,
): { model: string; usage: Record<string, number> } {
  const model = requestBody?.model || responseBody?.model || 'unknown'
  let usage: Record<string, number> = {}

  const u = responseBody?.usage
  if (u) {
    // Normalize: Anthropic uses input_tokens/output_tokens, OpenAI uses prompt_tokens/completion_tokens
    const promptTokens = u.prompt_tokens ?? u.input_tokens ?? 0
    const completionTokens = u.completion_tokens ?? u.output_tokens ?? 0
    usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: u.total_tokens ?? promptTokens + completionTokens,
    }
  }

  return { model, usage }
}

export async function logTrace(data: TraceData): Promise<void> {
  const traceId = randomUUID()
  const spanId = randomUUID()
  const { model, usage } = extractModelAndUsage(data.provider, data.requestBody, data.responseBody)
  const startISO = data.startTime.toISOString()
  const endISO = data.endTime.toISOString()

  try {
    // Create trace and span in parallel (Opik links them by trace_id regardless of order)
    await Promise.all([
      fetch(`${OPIK_BASE_URL}/api/v1/private/traces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: traceId,
          project_name: OPIK_PROJECT,
          name: `${data.method} ${data.path}`,
          start_time: startISO,
          end_time: endISO,
          input: data.requestBody,
          output: data.responseBody,
          metadata: { provider: data.provider, model, status_code: data.statusCode },
          tags: [data.provider, model],
        }),
      }),
      fetch(`${OPIK_BASE_URL}/api/v1/private/spans`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: spanId,
          trace_id: traceId,
          project_name: OPIK_PROJECT,
          name: `${data.provider} ${data.path}`,
          type: 'llm',
          start_time: startISO,
          end_time: endISO,
          input: data.requestBody,
          output: data.responseBody,
          model,
          provider: data.provider,
          usage,
          metadata: { status_code: data.statusCode },
          ...(data.error
            ? {
                error_info: {
                  exception_type: 'ProxyError',
                  message: data.error,
                  traceback: data.error,
                },
              }
            : {}),
        }),
      }),
    ])

    console.log(
      `[opik] trace=${traceId.slice(0, 8)} | ${data.provider} ${model} | ${usage.total_tokens || 0} tokens`,
    )
  } catch (err) {
    console.error('[opik] Failed to log trace:', err)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add llm-proxy/opik.ts
git commit -m "feat(llm-proxy): add Opik trace/span logging via REST API"
```

---

### Task 5: LLM proxy server

**Files:**

- Create: `llm-proxy/server.ts`

This is the main HTTP server that ties router, keys, and opik together. It handles:

- Path-based routing to upstream LLM providers
- API key lookup and swapping from keys.jsonc
- Request forwarding (with iptables routing through mitmproxy)
- Response streaming (tee for Opik logging)
- Fire-and-forget trace logging to Opik

- [ ] **Step 1: Write server.ts**

```typescript
import { resolveRoute } from './router'
import { loadKeys, extractCallerAuth, resolveRealKey, type KeyConfig } from './keys'
import { logTrace } from './opik'

const PORT = parseInt(process.env.LLM_PROXY_PORT || '4000')
const KEYS_PATH = process.env.KEYS_PATH || '/app/keys.jsonc'

let keyConfig: KeyConfig = loadKeys(KEYS_PATH)

// Reload keys on SIGHUP (e.g. docker kill --signal=HUP <container>)
process.on('SIGHUP', () => {
  console.log('[proxy] Reloading key config...')
  keyConfig = loadKeys(KEYS_PATH)
  console.log(`[proxy] Loaded ${Object.keys(keyConfig).length} local keys`)
})

// Hop-by-hop headers to strip when forwarding
const SKIP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
])

function buildUpstreamHeaders(
  req: Request,
  realKey: string | null,
  callerAuth: ReturnType<typeof extractCallerAuth>,
): Headers {
  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (SKIP_HEADERS.has(key.toLowerCase())) return
    headers.set(key, value)
  })

  // Swap API key if we resolved a real one
  if (realKey && callerAuth) {
    if (callerAuth.format === 'bearer') {
      headers.set('authorization', `Bearer ${realKey}`)
    } else {
      headers.set(callerAuth.header, realKey)
    }
  }

  return headers
}

function parseStreamForMetadata(streamText: string): any {
  // Parse SSE stream to extract metadata. Handles both Anthropic and OpenAI formats.
  //
  // Anthropic: event: message_start (has model, input usage),
  //            event: message_delta (has output usage), event: message_stop
  // OpenAI:    data: chunks with usage in final chunk before data: [DONE]
  const lines = streamText.split('\n')
  let result: any = { _stream: true }
  let currentEvent = ''

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      currentEvent = line.slice(7).trim()
      continue
    }
    if (!line.startsWith('data: ') || line === 'data: [DONE]') continue

    let parsed: any
    try {
      parsed = JSON.parse(line.slice(6))
    } catch {
      continue
    }

    // Anthropic: message_start contains model and input token usage
    if (currentEvent === 'message_start' || parsed?.type === 'message_start') {
      const msg = parsed.message || parsed
      result.model = msg.model || result.model
      if (msg.usage) {
        result.usage = { ...result.usage, input_tokens: msg.usage.input_tokens }
      }
    }

    // Anthropic: message_delta contains output token usage
    if (currentEvent === 'message_delta' || parsed?.type === 'message_delta') {
      if (parsed.usage) {
        result.usage = { ...result.usage, output_tokens: parsed.usage.output_tokens }
      }
    }

    // OpenAI: usage may appear in any chunk (typically the last)
    if (parsed.usage?.prompt_tokens !== undefined) {
      result.usage = parsed.usage
    }
    if (parsed.model) {
      result.model = parsed.model
    }

    currentEvent = ''
  }

  return result
}

function stripRespHeaders(upstream: Response): Headers {
  const headers = new Headers()
  upstream.headers.forEach((value, key) => {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  })
  return headers
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response('ok')
    }

    // Resolve route
    const route = resolveRoute(url.pathname)
    if (!route) {
      return Response.json(
        {
          error: 'Unknown route. Use /<provider>/path or /<hostname>/path',
          examples: ['/anthropic/v1/messages', '/openai/v1/chat/completions', '/api.openrouter.com/v1/messages'],
        },
        { status: 404 },
      )
    }

    // Extract and resolve API key
    const callerAuth = extractCallerAuth(req.headers)
    let realKey: string | null = null
    if (callerAuth) {
      const resolved = resolveRealKey(callerAuth.key, route.provider, keyConfig)
      if (resolved.isLocalKey && !resolved.realKey) {
        return Response.json(
          { error: `No ${route.provider} key configured for this local API key` },
          { status: 401 },
        )
      }
      realKey = resolved.realKey
    }

    // Build upstream request
    const upstreamUrl = `${route.upstream}${route.path}${url.search}`
    const upstreamHeaders = buildUpstreamHeaders(req, realKey, callerAuth)

    const startTime = new Date()
    let requestBody: any = null

    try {
      // Read request body
      const bodyText =
        req.method !== 'GET' && req.method !== 'HEAD' ? await req.text() : null
      if (bodyText) {
        try {
          requestBody = JSON.parse(bodyText)
        } catch {
          requestBody = bodyText
        }
      }

      console.log(`[proxy] ${req.method} ${url.pathname} -> ${upstreamUrl}`)

      // Forward request (iptables routes outbound 443 through mitmproxy)
      const upstreamResp = await fetch(upstreamUrl, {
        method: req.method,
        headers: upstreamHeaders,
        body: bodyText,
      })

      const contentType = upstreamResp.headers.get('content-type') || ''
      const respHeaders = stripRespHeaders(upstreamResp)

      // Non-streaming response: capture full body for Opik
      if (!contentType.includes('text/event-stream')) {
        const endTime = new Date()
        const respText = await upstreamResp.text()
        let responseBody: any
        try {
          responseBody = JSON.parse(respText)
        } catch {
          responseBody = respText
        }

        // Fire-and-forget Opik logging
        logTrace({
          provider: route.provider,
          method: req.method,
          path: route.path,
          requestBody,
          responseBody,
          statusCode: upstreamResp.status,
          startTime,
          endTime,
        }).catch(() => {})

        return new Response(respText, {
          status: upstreamResp.status,
          headers: respHeaders,
        })
      }

      // Streaming response: tee the stream
      if (upstreamResp.body) {
        const [clientStream, logStream] = upstreamResp.body.tee()

        // Read log stream in background for Opik
        ;(async () => {
          try {
            const reader = logStream.getReader()
            const chunks: Uint8Array[] = []
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value) chunks.push(value)
            }
            const fullText = new TextDecoder().decode(Buffer.concat(chunks))
            const responseBody = parseStreamForMetadata(fullText)
            logTrace({
              provider: route.provider,
              method: req.method,
              path: route.path,
              requestBody,
              responseBody,
              statusCode: upstreamResp.status,
              startTime,
              endTime: new Date(),
            }).catch(() => {})
          } catch (err) {
            console.error('[proxy] Error reading log stream:', err)
          }
        })()

        return new Response(clientStream, {
          status: upstreamResp.status,
          headers: respHeaders,
        })
      }

      return new Response(null, {
        status: upstreamResp.status,
        headers: respHeaders,
      })
    } catch (err: any) {
      const endTime = new Date()
      logTrace({
        provider: route.provider,
        method: req.method,
        path: route.path,
        requestBody,
        responseBody: null,
        statusCode: 502,
        startTime,
        endTime,
        error: err.message,
      }).catch(() => {})

      return Response.json(
        { error: 'Upstream request failed', message: err.message },
        { status: 502 },
      )
    }
  },
})

console.log(`[llm-proxy] Listening on http://localhost:${PORT}`)
console.log(`[llm-proxy] Keys: ${Object.keys(keyConfig).length} local keys loaded`)
console.log(`[llm-proxy] Opik: ${process.env.OPIK_BASE_URL || 'http://opik-backend:8080'}`)
console.log(`[llm-proxy] Routes: /anthropic/*, /openai/*, /<hostname>/*`)
```

- [ ] **Step 2: Verify all tests still pass**

Run: `cd llm-proxy && bun test`
Expected: All router and keys tests pass (server.ts has no unit tests — it's an integration entry point)

- [ ] **Step 3: Commit**

```bash
git add llm-proxy/server.ts
git commit -m "feat(llm-proxy): add main proxy server with routing, key swap, and Opik logging"
```

---

### Task 6: LLM proxy Docker setup

**Files:**

- Create: `llm-proxy/Dockerfile`
- Create: `llm-proxy/entrypoint.sh`

- [ ] **Step 1: Write Dockerfile**

```dockerfile
FROM oven/bun:latest

USER root
RUN apt-get update && \
    apt-get install -y --no-install-recommends iptables ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

COPY package.json tsconfig.json /app/
COPY server.ts router.ts keys.ts opik.ts /app/

ENTRYPOINT ["/entrypoint.sh"]
```

- [ ] **Step 2: Write entrypoint.sh**

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

cp "$CERT_PATH" /usr/local/share/ca-certificates/mitmproxy-ca.crt
update-ca-certificates
export NODE_EXTRA_CA_CERTS="$CERT_PATH"

# iptables: redirect outbound HTTP/HTTPS to mitmproxy transparent proxy
# Skip UID 1000 (mitmproxy) to avoid redirect loops
echo "==> Setting up iptables rules..."
iptables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
iptables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
iptables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
ip6tables -t nat -A OUTPUT -m owner --uid-owner 1000 -j RETURN
ip6tables -t nat -A OUTPUT -p tcp --dport 80  -j REDIRECT --to-port 8085
ip6tables -t nat -A OUTPUT -p tcp --dport 443 -j REDIRECT --to-port 8085
echo "==> iptables configured."

echo "==> Installing dependencies..."
cd /app
bun install

echo "==> Starting LLM proxy..."
exec bun run server.ts
```

- [ ] **Step 3: Verify Docker image builds**

Run: `docker build -t llm-proxy-test ./llm-proxy`
Expected: Successfully built

- [ ] **Step 4: Commit**

```bash
git add llm-proxy/Dockerfile llm-proxy/entrypoint.sh
git commit -m "feat(llm-proxy): add Dockerfile and entrypoint with iptables + CA cert setup"
```

---

## Chunk 3: Infrastructure & Scripts

### Task 7: Docker compose restructure and Opik network override

**Files:**

- Modify: `docker-compose.yml`
- Create: `opik-network.yml`

Key changes to docker-compose.yml:

1. Rename `proxy` service → `mitmproxy` (intuitive name)
2. Add `llm-proxy` service (default stack, shares mitmproxy's network namespace)
3. Add `profiles: ["chat"]` to `claude` service (now optional)
4. Change `claude-api` port from 4000 → 4100 (avoid conflict with llm-proxy)
5. Update all `network_mode: "service:proxy"` → `network_mode: "service:mitmproxy"`
6. Add shared external network with aliases
7. Add `llm-proxy` and `mitmproxy-ui` as network aliases on the mitmproxy service

- [ ] **Step 1: Write the updated docker-compose.yml**

```yaml
services:
  mitmproxy:
    build: ./proxy
    command:
      - mitmweb
      - --mode
      - regular@8080
      - --mode
      - transparent@8085
      - --web-host
      - "0.0.0.0"
      - --web-port
      - "8081"
      - --set
      - web_password=${MITMPROXY_WEB_PASSWORD:-mitmpass}
      - --verbose
    ports:
      - "${LLM_PROXY_PORT:-4000}:4000"    # llm-proxy
      - "${MITMPROXY_UI_PORT:-8081}:8081"  # mitmproxy web UI
      - "3000:3000"                         # chat UI (optional: chat profile)
      - "4100:4100"                         # claude-api (optional: api profile)
    environment:
      - PYTHONUNBUFFERED=1
    volumes:
      - mitmproxy-certs:/home/mitmproxy/.mitmproxy
    healthcheck:
      test: ["CMD", "python3", "-c", "import socket; s=socket.create_connection(('localhost',8081),2); s.close()"]
      interval: 2s
      timeout: 5s
      retries: 15
    networks:
      default:
      llm-proxy-net:
        aliases:
          - llm-proxy
          - mitmproxy-ui

  llm-proxy:
    build: ./llm-proxy
    network_mode: "service:mitmproxy"
    depends_on:
      mitmproxy:
        condition: service_healthy
    cap_add:
      - NET_ADMIN
    environment:
      - LLM_PROXY_PORT=4000
      - OPIK_BASE_URL=${OPIK_BASE_URL:-http://opik-backend:8080}
      - OPIK_PROJECT_NAME=${OPIK_PROJECT_NAME:-llm-proxy}
      - KEYS_PATH=/app/keys.jsonc
    volumes:
      - ./keys.jsonc:/app/keys.jsonc:ro
      - mitmproxy-certs:/certs:ro
    healthcheck:
      test: ["CMD", "curl", "-sf", "http://localhost:4000/health"]
      interval: 2s
      timeout: 5s
      retries: 15

  claude:
    build: ./claude
    profiles: ["chat"]
    network_mode: "service:mitmproxy"
    depends_on:
      mitmproxy:
        condition: service_healthy
    cap_add:
      - NET_ADMIN
    environment:
      - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - MITMPROXY_WEB_PASSWORD=${MITMPROXY_WEB_PASSWORD:-mitmpass}
      - HTTP_PROXY=http://localhost:8080
      - HTTPS_PROXY=http://localhost:8080
      - NO_PROXY=localhost,127.0.0.1
    volumes:
      - ./app:/app
      - mitmproxy-certs:/certs:ro
      - ./credentials.json:/credentials/.credentials.json:ro

  claude-code:
    build: ./claude-code
    profiles: ["cli"]
    network_mode: "service:mitmproxy"
    depends_on:
      mitmproxy:
        condition: service_healthy
    cap_add:
      - NET_ADMIN
    stdin_open: true
    tty: true
    environment:
      - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - HTTP_PROXY=http://localhost:8080
      - HTTPS_PROXY=http://localhost:8080
      - NO_PROXY=localhost,127.0.0.1
    volumes:
      - mitmproxy-certs:/certs:ro
      - claude-code-home:/root

  claude-api:
    build: ./claude-api
    profiles: ["api"]
    network_mode: "service:mitmproxy"
    depends_on:
      mitmproxy:
        condition: service_healthy
    cap_add:
      - NET_ADMIN
    environment:
      - CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - API_SERVER_KEY=${CLAUDE_PROXY_API_KEY:-}
      - API_PORT=4100
      - HTTP_PROXY=http://localhost:8080
      - HTTPS_PROXY=http://localhost:8080
      - NO_PROXY=localhost,127.0.0.1
    volumes:
      - ./api-debug:/api-debug
      - mitmproxy-certs:/certs:ro
      - ./credentials.json:/credentials/.credentials.json:ro

networks:
  llm-proxy-net:
    name: ${NETWORK_NAME:-llm-proxy-net}
    external: true

volumes:
  mitmproxy-certs:
  claude-code-home:
```

- [ ] **Step 2: Write opik-network.yml**

This is a docker-compose override file passed alongside Opik's own compose file to attach Opik's backend and frontend to the shared network.

```yaml
# Opik network override — attaches Opik services to the shared LLM proxy network.
# Used by start.sh:
#   docker compose -f opik/deployment/docker-compose/docker-compose.yaml \
#                  -f opik-network.yml --profile opik up -d

networks:
  llm-proxy-net:
    name: ${NETWORK_NAME:-llm-proxy-net}
    external: true

services:
  backend:
    networks:
      default:
      llm-proxy-net:
        aliases:
          - opik-backend
  frontend:
    networks:
      default:
      llm-proxy-net:
        aliases:
          - opik-frontend
```

- [ ] **Step 3: Update claude-api to use configurable port**

The `claude-api/api-server.ts` currently hardcodes port 4000. Change to use `API_PORT` env var:

In `claude-api/api-server.ts`, line 3, change:

```typescript
const API_PORT = 4000
```

to:

```typescript
const API_PORT = parseInt(process.env.API_PORT || '4100')
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml opik-network.yml claude-api/api-server.ts
git commit -m "feat: restructure docker-compose with llm-proxy, shared network, and profiles"
```

---

### Task 8: setup.sh

**Files:**

- Create: `setup.sh`

- [ ] **Step 1: Write setup.sh**

```bash
#!/bin/bash
set -euo pipefail

echo "╔═══════════════════════════════════════════╗"
echo "║   LLM Observability Stack — Setup         ║"
echo "╚═══════════════════════════════════════════╝"
echo ""
echo "This will generate .env and keys.jsonc files."
echo ""

# ── Defaults ──
NETWORK_NAME="llm-proxy-net"
COMPOSE_PROJECT_NAME="llm-stack"
OPIK_PROJECT_NAME="llm-proxy"
LLM_PROXY_PORT="4000"
MITMPROXY_UI_PORT="8081"
MITMPROXY_WEB_PASSWORD="mitmpass"

# ── Network & Docker ──
read -rp "Docker network name [$NETWORK_NAME]: " input
NETWORK_NAME="${input:-$NETWORK_NAME}"

read -rp "Compose project name [$COMPOSE_PROJECT_NAME]: " input
COMPOSE_PROJECT_NAME="${input:-$COMPOSE_PROJECT_NAME}"

# ── LLM Proxy ──
read -rp "Opik project name for traces [$OPIK_PROJECT_NAME]: " input
OPIK_PROJECT_NAME="${input:-$OPIK_PROJECT_NAME}"

read -rp "LLM proxy port [$LLM_PROXY_PORT]: " input
LLM_PROXY_PORT="${input:-$LLM_PROXY_PORT}"

# ── mitmproxy ──
read -rp "mitmproxy UI port [$MITMPROXY_UI_PORT]: " input
MITMPROXY_UI_PORT="${input:-$MITMPROXY_UI_PORT}"

read -rp "mitmproxy web password [$MITMPROXY_WEB_PASSWORD]: " input
MITMPROXY_WEB_PASSWORD="${input:-$MITMPROXY_WEB_PASSWORD}"

# ── Optional services ──
echo ""
echo "Optional services (these are in addition to the default mitmproxy + llm-proxy + opik stack):"
PROFILES=""

read -rp "  Enable Claude chat UI? [y/N]: " input
[[ "${input,,}" == "y" ]] && PROFILES="${PROFILES:+$PROFILES,}chat"

read -rp "  Enable Claude API proxy? [y/N]: " input
[[ "${input,,}" == "y" ]] && PROFILES="${PROFILES:+$PROFILES,}api"

read -rp "  Enable Claude Code CLI? [y/N]: " input
[[ "${input,,}" == "y" ]] && PROFILES="${PROFILES:+$PROFILES,}cli"

# ── API Keys (for optional Claude services) ──
ANTHROPIC_API_KEY=""
if [[ -n "$PROFILES" ]]; then
  echo ""
  echo "Claude services need an Anthropic API key (or use credentials.json):"
  read -rp "  Anthropic API key (Enter to skip): " ANTHROPIC_API_KEY
fi

# ── Key config for llm-proxy ──
echo ""
echo "LLM Proxy key configuration:"
echo "  Clients send a local API key to llm-proxy, which swaps it for the real provider key."
echo ""

LOCAL_KEY=""
ANTHROPIC_PROVIDER_KEY=""
OPENAI_PROVIDER_KEY=""
OPENROUTER_PROVIDER_KEY=""

read -rp "  Local API key (what clients will send — Enter to skip, edit keys.jsonc later): " LOCAL_KEY

if [[ -n "$LOCAL_KEY" ]]; then
  read -rp "    Anthropic key for this local key: " ANTHROPIC_PROVIDER_KEY
  read -rp "    OpenAI key for this local key: " OPENAI_PROVIDER_KEY
  read -rp "    OpenRouter key for this local key (Enter to skip): " OPENROUTER_PROVIDER_KEY
fi

# ── Write .env ──
{
  echo "# LLM Observability Stack — generated by setup.sh"
  echo ""
  echo "# Docker"
  echo "COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME}"
  echo "NETWORK_NAME=${NETWORK_NAME}"
  echo ""
  echo "# LLM Proxy"
  echo "LLM_PROXY_PORT=${LLM_PROXY_PORT}"
  echo "OPIK_PROJECT_NAME=${OPIK_PROJECT_NAME}"
  echo ""
  echo "# mitmproxy"
  echo "MITMPROXY_UI_PORT=${MITMPROXY_UI_PORT}"
  echo "MITMPROXY_WEB_PASSWORD=${MITMPROXY_WEB_PASSWORD}"
  echo ""
  echo "# Optional services (comma-separated: chat,api,cli)"
  if [[ -n "$PROFILES" ]]; then
    echo "COMPOSE_PROFILES=${PROFILES}"
  else
    echo "# COMPOSE_PROFILES=chat,api,cli"
  fi
  echo ""
  echo "# Anthropic API key (for optional Claude services)"
  if [[ -n "$ANTHROPIC_API_KEY" ]]; then
    echo "ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}"
  else
    echo "# ANTHROPIC_API_KEY="
  fi
} > .env

echo ""
echo "==> .env written"

# ── Write keys.jsonc ──
if [[ -n "$LOCAL_KEY" ]]; then
  ENTRIES=()
  [[ -n "$ANTHROPIC_PROVIDER_KEY" ]] && ENTRIES+=("    \"anthropic\": \"${ANTHROPIC_PROVIDER_KEY}\"")
  [[ -n "$OPENAI_PROVIDER_KEY" ]] && ENTRIES+=("    \"openai\": \"${OPENAI_PROVIDER_KEY}\"")
  [[ -n "$OPENROUTER_PROVIDER_KEY" ]] && ENTRIES+=("    \"api.openrouter.com\": \"${OPENROUTER_PROVIDER_KEY}\"")

  {
    echo "{"
    echo "  \"${LOCAL_KEY}\": {"
    # Print entries with commas between (no trailing comma for valid JSON)
    for i in "${!ENTRIES[@]}"; do
      if [[ $i -lt $((${#ENTRIES[@]} - 1)) ]]; then
        echo "${ENTRIES[$i]},"
      else
        echo "${ENTRIES[$i]}"
      fi
    done
    echo "  }"
    echo "}"
  } > keys.jsonc
  echo "==> keys.jsonc written"
elif [[ ! -f keys.jsonc ]]; then
  cp keys.jsonc.example keys.jsonc
  echo "==> keys.jsonc.example copied to keys.jsonc (edit to add your keys)"
fi

echo ""
echo "Setup complete! Run ./start.sh to start the stack."
echo ""
echo "URLs (after starting):"
echo "  LLM Proxy:    http://localhost:${LLM_PROXY_PORT}"
echo "  mitmproxy UI: http://localhost:${MITMPROXY_UI_PORT}/?token=${MITMPROXY_WEB_PASSWORD}"
echo "  Opik UI:      http://localhost:5173"
echo ""
echo "Configure your SDKs:"
echo "  ANTHROPIC_BASE_URL=http://localhost:${LLM_PROXY_PORT}/anthropic"
echo "  OPENAI_BASE_URL=http://localhost:${LLM_PROXY_PORT}/openai"
echo "  Generic:      http://localhost:${LLM_PROXY_PORT}/<hostname>/path"
```

- [ ] **Step 2: Make executable**

Run: `chmod +x setup.sh`

- [ ] **Step 3: Commit**

```bash
git add setup.sh
git commit -m "feat: add interactive setup.sh for .env and keys.jsonc generation"
```

---

### Task 9: start.sh and stop.sh

**Files:**

- Create: `start.sh`
- Create: `stop.sh`

- [ ] **Step 1: Write start.sh**

```bash
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
echo "╔═══════════════════════════════════════════╗"
echo "║   Stack is running!                        ║"
echo "╠═══════════════════════════════════════════╣"
echo "║                                            ║"
echo "║   LLM Proxy:    http://localhost:${LLM_PROXY_PORT:-4000}        ║"
echo "║   mitmproxy UI: http://localhost:${MITMPROXY_UI_PORT:-8081}        ║"
echo "║   Opik UI:      http://localhost:5173        ║"
echo "║                                            ║"
echo "╠═══════════════════════════════════════════╣"
echo "║   Configure your SDKs:                     ║"
echo "║                                            ║"
echo "║   ANTHROPIC_BASE_URL=                      ║"
echo "║     http://localhost:${LLM_PROXY_PORT:-4000}/anthropic       ║"
echo "║   OPENAI_BASE_URL=                         ║"
echo "║     http://localhost:${LLM_PROXY_PORT:-4000}/openai          ║"
echo "║                                            ║"
echo "╚═══════════════════════════════════════════╝"
```

- [ ] **Step 2: Write stop.sh**

```bash
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

echo "==> Stopping proxy stack..."
docker compose -p "${COMPOSE_PROJECT_NAME:-llm-stack}" down

if [[ -d "$OPIK_DIR/deployment/docker-compose" ]]; then
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
```

- [ ] **Step 3: Make executable**

Run: `chmod +x start.sh stop.sh`

- [ ] **Step 4: Commit**

```bash
git add start.sh stop.sh
git commit -m "feat: add start.sh and stop.sh for full stack orchestration"
```

---

### Task 10: README update

**Files:**

- Modify: `README.md`

- [ ] **Step 1: Rewrite README.md**

```markdown
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
        │
        │  ANTHROPIC_BASE_URL=http://localhost:4000/anthropic
        │  OPENAI_BASE_URL=http://localhost:4000/openai
        │  http://localhost:4000/<any-hostname>/path
        │
        ▼
┌─ llm-proxy-net ──────────────────────────────────────────────┐
│                                                               │
│  ┌─────────────┐    ┌───────────┐    ┌──────────────────┐   │
│  │  llm-proxy   │───▶│ mitmproxy │───▶│ upstream APIs     │   │
│  │  :4000       │    │ :8081 UI  │    │ anthropic, openai │   │
│  │  key swap +  │    │           │    │ openrouter, etc.  │   │
│  │  opik logging│    └───────────┘    └──────────────────┘   │
│  └──────┬──────┘                                             │
│         │ traces                                              │
│         ▼                                                     │
│  ┌─────────────────────────────────────────────┐             │
│  │  Opik                                        │             │
│  │  :5173 UI  — trace/span visualization        │             │
│  └─────────────────────────────────────────────┘             │
└───────────────────────────────────────────────────────────────┘
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

```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README for LLM observability stack"
```

---

### Task 11: End-to-end verification

- [ ] **Step 1: Copy .env.example and create minimal config**

```bash
cp .env.example .env
echo '{}' > keys.jsonc
```

- [ ] **Step 2: Create the network manually (simulating start.sh)**

Run: `docker network create llm-proxy-net 2>/dev/null || true`

- [ ] **Step 3: Build and start the proxy stack only (no Opik for quick test)**

Run: `docker compose up -d --build mitmproxy llm-proxy`

- [ ] **Step 4: Verify llm-proxy health**

Run: `curl -s http://localhost:4000/health`
Expected: `ok`

- [ ] **Step 5: Verify routing returns proper error for unknown route**

Run: `curl -s http://localhost:4000/unknown/test`
Expected: JSON with error message and examples, status 404

- [ ] **Step 6: Verify mitmproxy web UI is accessible**

Open: `http://localhost:8081/?token=mitmpass`
Expected: mitmproxy web interface loads

- [ ] **Step 7: Test with a real API call (if key available)**

```bash
curl -s http://localhost:4000/anthropic/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_REAL_KEY" \
  -d '{
    "model": "claude-haiku-4-5-20251001",
    "max_tokens": 50,
    "messages": [{"role": "user", "content": "Say hello in 3 words"}]
  }'
```

Expected: Response from Anthropic API, visible in mitmproxy UI

- [ ] **Step 8: Tear down**

Run: `docker compose down && docker network rm llm-proxy-net 2>/dev/null || true`

- [ ] **Step 9: Full stack test with start.sh**

Run: `./start.sh`
Expected: Opik clones/starts, proxy stack starts, URLs printed

Run: `./stop.sh --clean`
Expected: Everything stops cleanly
