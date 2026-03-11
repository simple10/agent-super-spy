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
