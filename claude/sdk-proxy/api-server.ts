import { readFileSync } from 'fs'
import { applyCacheControlMax, CACHE_5M, type CacheHints } from './cache-control'
import { transformInput } from './cache-plugin'
import { loadedInputPluginSpecs } from './plugins/transform/input'

const API_PORT = parseInt(process.env.API_PORT || '4100')
const ANTHROPIC_BASE = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com'

// Load the captured API template
const template = JSON.parse(readFileSync('/data/api.json', 'utf-8'))

// Get real auth token from credentials
function getAuthToken(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const creds = JSON.parse(readFileSync('/credentials/.credentials.json', 'utf-8'))
    return creds?.claudeAiOauth?.accessToken ?? ''
  } catch {
    return ''
  }
}

const authToken = getAuthToken()
const serverKey = process.env.API_SERVER_KEY || ''

// Determine which auth header the SDK uses (authorization vs x-api-key)
const authHeaderName = template.headers['authorization'] ? 'authorization' : 'x-api-key'
const authHeaderValue = authHeaderName === 'authorization' ? `Bearer ${authToken}` : authToken

// Query params captured from the SDK (e.g. ?beta=true)
const templateQueryParams: Record<string, string> = template.queryParams || {}

// Headers to skip when building forwarding headers (connection-level or per-request)
const skipHeaders = new Set(['host', 'connection', 'content-length', 'transfer-encoding'])

function buildForwardingHeaders(bodyLength: number): Record<string, string> {
  const h: Record<string, string> = {}
  for (const [key, value] of Object.entries(template.headers)) {
    if (skipHeaders.has(key.toLowerCase())) continue
    // Replace redacted auth with real token
    if (key === 'authorization' || key === 'x-api-key') {
      h[authHeaderName] = authHeaderValue
    } else {
      h[key] = value as string
    }
  }
  h['host'] = 'api.anthropic.com'
  h['content-length'] = String(bodyLength)
  return h
}

function buildSimpleHeaders(): Record<string, string> {
  return {
    [authHeaderName]: authHeaderValue,
    'anthropic-version': (template.headers['anthropic-version'] as string) || '2023-06-01',
    'content-type': 'application/json',
    accept: 'application/json',
    ...(template.headers['anthropic-beta']
      ? { 'anthropic-beta': template.headers['anthropic-beta'] as string }
      : {}),
    ...(template.headers['user-agent']
      ? { 'user-agent': template.headers['user-agent'] as string }
      : {}),
  }
}

function validateApiKey(req: Request): Response | null {
  if (!serverKey) return null // no validation if no key configured
  const callerKey = req.headers.get('x-api-key') || ''
  if (callerKey !== serverKey) {
    return new Response(
      JSON.stringify({
        type: 'error',
        error: { type: 'authentication_error', message: 'Invalid API key' },
      }),
      {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      }
    )
  }
  return null
}

function stripCacheControl(blocks: any[]): any[] {
  return blocks.map(({ cache_control, ...rest }: any) => rest)
}

function fixToolResultOrder(messages: any[]): any[] {
  return messages.map((msg: any, i: number) => {
    if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg
    const toolResults = msg.content.filter((b: any) => b.type === 'tool_result')
    if (toolResults.length === 0) return msg
    const others = msg.content.filter((b: any) => b.type !== 'tool_result')
    const firstType = msg.content[0]?.type
    if (firstType !== 'tool_result') {
      console.log(
        `[api] Fixed tool_result order in messages[${i}] (moved ${toolResults.length} tool_result(s) before ${others.length} other block(s))`
      )
    }
    return { ...msg, content: [...toolResults, ...others] }
  })
}

function mergeMessagesBody(callerBody: Record<string, unknown>): Record<string, unknown> {
  // Start with the caller's body as the base
  const merged: Record<string, unknown> = { ...callerBody }

  // System: always prepend template's system messages (stripped of cache_control), then caller's
  const templateSystem = stripCacheControl(template.body.system || [])
  if (callerBody.system) {
    const callerSystem = Array.isArray(callerBody.system)
      ? callerBody.system
      : [{ type: 'text', text: callerBody.system }]
    merged.system = [...templateSystem, ...callerSystem]
  } else {
    merged.system = templateSystem
  }

  // Fix tool_result ordering in messages (some clients send them after text blocks)
  if (Array.isArray(merged.messages)) {
    merged.messages = fixToolResultOrder(merged.messages as any[])
  }

  // Metadata: always preserve template's
  merged.metadata = template.body.metadata

  return merged
}

const server = Bun.serve({
  port: API_PORT,
  async fetch(req) {
    const url = new URL(req.url)

    // Detect cache-control route prefixes
    const cacheControlMax = url.pathname.startsWith('/cache-control-max')
    const cacheControlAuto = !cacheControlMax && url.pathname.startsWith('/cache-control-auto')
    const cachePrefix = cacheControlMax
      ? '/cache-control-max'
      : cacheControlAuto
      ? '/cache-control-auto'
      : ''
    const effectivePath = cachePrefix ? url.pathname.slice(cachePrefix.length) : url.pathname

    console.log(
      `[api] ${req.method} ${url.pathname}${cachePrefix ? ` (${cachePrefix.slice(1)})` : ''}`
    )

    // Validate caller's API key
    const authErr = validateApiKey(req)
    if (authErr) return authErr

    // POST /v1/messages — merge with template and forward
    if (effectivePath === '/v1/messages' && req.method === 'POST') {
      const callerBody = (await req.json()) as Record<string, unknown>
      let merged = mergeMessagesBody(callerBody)
      let cacheHints: CacheHints | undefined
      let disableCaching = false
      const cacheType = cacheControlMax ? 'max' : cacheControlAuto ? 'auto' : null

      if (cacheType) {
        const transformed = await transformInput(merged, { cacheType })
        merged = transformed.input
        cacheHints = transformed.cacheHints
        disableCaching = transformed.disableCaching === true
        if (cacheHints) {
          console.log(`[api] Applied input transform cache hints: ${JSON.stringify(cacheHints)}`)
        }
        if (disableCaching) {
          console.log('[api] Input transform disabled caching for this request')
        }
      }

      if (cacheControlMax && !disableCaching) {
        const applied = applyCacheControlMax(merged, cacheHints)
        merged = applied.body
        if (applied.changes.length > 0) {
          console.log(`[api] Added cache_control breakpoints: ${applied.changes.join(', ')}`)
        }
      } else if (cacheControlAuto && !disableCaching) {
        if (!merged.cache_control) {
          merged.cache_control = CACHE_5M
          console.log('[api] Added top-level cache_control (auto)')
        }
      }
      const bodyStr = JSON.stringify(merged)
      const headers = buildForwardingHeaders(Buffer.byteLength(bodyStr))

      // Merge template query params with any caller-provided ones (caller overrides)
      const queryStr = new URLSearchParams({
        ...templateQueryParams,
        ...Object.fromEntries(url.searchParams),
      }).toString()
      const targetUrl = queryStr
        ? `${ANTHROPIC_BASE}/v1/messages?${queryStr}`
        : `${ANTHROPIC_BASE}/v1/messages`

      const resp = await fetch(targetUrl, {
        method: 'POST',
        headers,
        body: bodyStr,
      })

      // Build response headers — pass through content-type and anthropic headers
      const respHeaders: Record<string, string> = {
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
      }
      resp.headers.forEach((value, key) => {
        if (key.startsWith('anthropic-') || key === 'request-id') {
          respHeaders[key] = value
        }
      })

      return new Response(resp.body, {
        status: resp.status,
        headers: respHeaders,
      })
    }

    // All other /v1/* endpoints — simple proxy
    if (effectivePath.startsWith('/v1/')) {
      const headers = buildSimpleHeaders()
      const fetchOpts: RequestInit = {
        method: req.method,
        headers,
      }

      if (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') {
        const body = await req.text()
        fetchOpts.body = body
        ;(headers as Record<string, string>)['content-length'] = String(Buffer.byteLength(body))
      }

      const resp = await fetch(`${ANTHROPIC_BASE}${effectivePath}${url.search}`, fetchOpts)

      return new Response(resp.body, {
        status: resp.status,
        headers: { 'Content-Type': resp.headers.get('Content-Type') || 'application/json' },
      })
    }

    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })
  },
})

console.log(`[api-server] Listening on http://localhost:${API_PORT}`)
console.log(
  `[api-server] Auth validation: ${serverKey ? 'enabled' : 'disabled (no API_SERVER_KEY)'}`
)
console.log(`[api-server] Forwarding to: ${ANTHROPIC_BASE}`)
console.log(`[api-server] Template auth header: ${authHeaderName}`)
console.log(`[api-server] Template query params: ${JSON.stringify(templateQueryParams)}`)
console.log(
  `[api-server] Input transform plugins: ${
    loadedInputPluginSpecs.length > 0 ? loadedInputPluginSpecs.join(', ') : 'none'
  }`
)
