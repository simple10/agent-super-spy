import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs'

const INTERCEPT_PORT = 9999
const OUTPUT_PATH = '/data/api.json'
const BACKUP_PATH = '/data/api.bak.json'

type CapturedRequest = {
  method: string
  url: string
  queryParams: Record<string, string>
  headers: Record<string, string>
  body: Record<string, unknown>
}

let captured = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }

  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(',')}}`
  }

  return JSON.stringify(value)
}

function formatDiffValue(value: unknown): string {
  const rendered = stableStringify(value)
  return rendered.length > 240 ? `${rendered.slice(0, 237)}...` : rendered
}

export function describeCaptureChanges(
  previous: CapturedRequest,
  current: CapturedRequest,
): string[] {
  const changes: string[] = []
  const headerKeys = [...new Set([...Object.keys(previous.headers), ...Object.keys(current.headers)])].sort()

  for (const key of headerKeys) {
    const before = previous.headers[key]
    const after = current.headers[key]
    if (before === after) continue
    changes.push(`headers.${key}: ${formatDiffValue(before)} -> ${formatDiffValue(after)}`)
  }

  const previousSystem = previous.body?.system
  const currentSystem = current.body?.system
  if (stableStringify(previousSystem) !== stableStringify(currentSystem)) {
    changes.push(
      `body.system: ${formatDiffValue(previousSystem)} -> ${formatDiffValue(currentSystem)}`
    )
  }

  return changes
}

function compareCaptureWithBackup(current: CapturedRequest): void {
  if (!existsSync(BACKUP_PATH)) return

  try {
    const previous = JSON.parse(readFileSync(BACKUP_PATH, 'utf-8')) as CapturedRequest
    const changes = describeCaptureChanges(previous, current)

    if (changes.length === 0) {
      unlinkSync(BACKUP_PATH)
      console.log(`[intercept] No header/system changes detected; removed ${BACKUP_PATH}`)
      return
    }

    console.log(`[intercept] Detected api.json changes:`)
    for (const change of changes) {
      console.log(`  ${change}`)
    }
  } catch (err: any) {
    console.log(`[intercept] Failed to compare ${OUTPUT_PATH} with ${BACKUP_PATH}: ${err.message}`)
  }
}

export const app = {
  port: INTERCEPT_PORT,
  async fetch(req) {
    const url = new URL(req.url)
    console.log(`[intercept] ${req.method} ${url.pathname}`)

    // Capture the /v1/messages request
    if (url.pathname === '/v1/messages' && req.method === 'POST') {
      const body = await req.json()

      // Collect headers, redact auth
      const headers: Record<string, string> = {}
      req.headers.forEach((value, key) => {
        if (key === 'authorization' || key === 'x-api-key') {
          headers[key] = value.substring(0, 20) + '****'
        } else {
          headers[key] = value
        }
      })

      // Capture query params
      const queryParams: Record<string, string> = {}
      url.searchParams.forEach((value, key) => {
        queryParams[key] = value
      })

      const capturedRequest: CapturedRequest = {
        method: req.method,
        url: url.pathname,
        queryParams,
        headers,
        body: isRecord(body) ? body : {},
      }

      writeFileSync(OUTPUT_PATH, JSON.stringify(capturedRequest, null, 2))
      console.log(`[intercept] Captured request → ${OUTPUT_PATH}`)
      compareCaptureWithBackup(capturedRequest)
      captured = true

      // Return a minimal streaming SSE response so the SDK exits cleanly
      const msgId = 'msg_intercepted_' + Date.now()
      const model = body.model || 'claude-sonnet-4-6'
      const inputTokens = 10

      const events = [
        `event: message_start\ndata: ${JSON.stringify({
          type: 'message_start',
          message: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: inputTokens,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              output_tokens: 1,
            },
          },
        })}\n`,
        `event: content_block_start\ndata: ${JSON.stringify({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })}\n`,
        `event: ping\ndata: ${JSON.stringify({ type: 'ping' })}\n`,
        `event: content_block_delta\ndata: ${JSON.stringify({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'OK' },
        })}\n`,
        `event: content_block_stop\ndata: ${JSON.stringify({
          type: 'content_block_stop',
          index: 0,
        })}\n`,
        `event: message_delta\ndata: ${JSON.stringify({
          type: 'message_delta',
          delta: { stop_reason: 'end_turn', stop_sequence: null },
          usage: { output_tokens: 1 },
        })}\n`,
        `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n`,
      ]

      return new Response(events.join('\n'), {
        headers: {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
          'request-id': 'req_intercepted_' + Date.now(),
        },
      })
    }

    // For any other request (e.g. /v1/models), return a minimal OK
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  },
}

if (import.meta.main) {
  Bun.serve(app)
  console.log(`[intercept] Listening on http://localhost:${INTERCEPT_PORT}`)
}
