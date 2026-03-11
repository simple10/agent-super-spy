import { resolveRoute } from './router'
import { loadKeys, extractCallerAuth, resolveRealKey, type KeyConfig } from './keys'
import { buildUpstreamHeaders, stripRespHeaders } from './headers'
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

export function parseStreamForMetadata(streamText: string): any {
  // Parse SSE stream to extract metadata. Handles both Anthropic and OpenAI formats.
  //
  // Anthropic: event: message_start (has model, input usage),
  //            event: message_delta (has output usage), event: message_stop
  // OpenAI:    data: chunks with usage in final chunk before data: [DONE]
  const lines = streamText.split('\n')
  let result: any = { _stream: true }
  let currentEvent = ''
  const anthropicTextBlocks = new Map<number, string>()
  const openaiChoiceText = new Map<number, string>()
  const mergeUsage = (usage: any) => {
    if (usage && typeof usage === 'object') {
      result.usage = { ...result.usage, ...usage }
    }
  }

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
      result.id = msg.id || result.id
      result.type = msg.type || result.type
      result.role = msg.role || result.role
      mergeUsage(msg.usage)
    }

    // Anthropic: message_delta contains output token usage
    if (currentEvent === 'message_delta' || parsed?.type === 'message_delta') {
      mergeUsage(parsed.usage)
      if (parsed?.delta && 'stop_reason' in parsed.delta) {
        result.stop_reason = parsed.delta.stop_reason
      } else if ('stop_reason' in parsed) {
        result.stop_reason = parsed.stop_reason
      }
      if (parsed?.delta && 'stop_sequence' in parsed.delta) {
        result.stop_sequence = parsed.delta.stop_sequence
      } else if ('stop_sequence' in parsed) {
        result.stop_sequence = parsed.stop_sequence
      }
    }

    if (currentEvent === 'content_block_start' || parsed?.type === 'content_block_start') {
      const index = parsed.index ?? 0
      const text = parsed.content_block?.type === 'text' ? parsed.content_block?.text : ''
      if (typeof text === 'string' && text) {
        anthropicTextBlocks.set(index, (anthropicTextBlocks.get(index) || '') + text)
      }
    }

    if (currentEvent === 'content_block_delta' || parsed?.type === 'content_block_delta') {
      const index = parsed.index ?? 0
      const text = parsed.delta?.type === 'text_delta' ? parsed.delta?.text : ''
      if (typeof text === 'string' && text) {
        anthropicTextBlocks.set(index, (anthropicTextBlocks.get(index) || '') + text)
      }
    }

    // OpenAI: usage may appear in any chunk (typically the last)
    if (parsed.usage?.prompt_tokens !== undefined) {
      mergeUsage(parsed.usage)
    }
    if (parsed.model) {
      result.model = parsed.model
    }

    if (Array.isArray(parsed.choices)) {
      for (const choice of parsed.choices) {
        const index = choice?.index ?? 0
        let text = ''

        if (typeof choice?.delta?.content === 'string') {
          text = choice.delta.content
        } else if (Array.isArray(choice?.delta?.content)) {
          text = choice.delta.content
            .map((item: any) => (item?.type === 'text' && typeof item?.text === 'string' ? item.text : ''))
            .join('')
        } else if (typeof choice?.message?.content === 'string') {
          text = choice.message.content
        }

        if (text) {
          openaiChoiceText.set(index, (openaiChoiceText.get(index) || '') + text)
        }
      }
    }

    currentEvent = ''
  }

  const anthropicText = [...anthropicTextBlocks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join('\n\n')
    .trim()

  const openaiText = [...openaiChoiceText.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, text]) => text)
    .join('\n\n')
    .trim()

  if (anthropicText || openaiText) {
    result.text = anthropicText || openaiText
  }

  if (anthropicText && !result.content) {
    result.content = [{ type: 'text', text: anthropicText }]
  }

  return result
}

const app = {
  async fetch(req: Request) {
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

        // Read log stream in background for Opik (with timeout to prevent memory leaks)
        ;(async () => {
          const reader = logStream.getReader()
          const logTimeout = setTimeout(() => reader.cancel(), 120_000)
          try {
            const chunks: Uint8Array[] = []
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              if (value && value.byteLength > 0) chunks.push(value)
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
          } finally {
            clearTimeout(logTimeout)
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
}

if (import.meta.main) {
  Bun.serve({
    port: PORT,
    fetch: app.fetch,
  })

  console.log(`[llm-proxy] Listening on http://localhost:${PORT}`)
  console.log(`[llm-proxy] Keys: ${Object.keys(keyConfig).length} local keys loaded`)
  console.log(`[llm-proxy] Opik: ${process.env.OPIK_BASE_URL || 'http://opik-backend:8080'}`)
  console.log(`[llm-proxy] Routes: /anthropic/*, /openai/*, /<hostname>/*`)
}
