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

export function generateUuidV7(date: Date = new Date()): string {
  const timestamp = BigInt(date.getTime())
  const bytes = new Uint8Array(16)

  // RFC 9562 UUIDv7: first 48 bits are the Unix epoch timestamp in milliseconds.
  for (let i = 5; i >= 0; i--) {
    bytes[i] = Number((timestamp >> BigInt((5 - i) * 8)) & 0xffn)
  }

  crypto.getRandomValues(bytes.subarray(6))

  // Version 7 in the high nibble, RFC 4122 variant in the next field.
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

async function postOpik(path: string, body: Record<string, unknown>): Promise<void> {
  const resp = await fetch(`${OPIK_BASE_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`${path} -> ${resp.status} ${text}`.trim())
  }
}

export async function logTrace(data: TraceData): Promise<void> {
  const traceId = generateUuidV7(data.startTime)
  const spanId = generateUuidV7(data.endTime)
  const { model, usage } = extractModelAndUsage(data.provider, data.requestBody, data.responseBody)
  const startISO = data.startTime.toISOString()
  const endISO = data.endTime.toISOString()

  try {
    await postOpik('/v1/private/traces', {
      id: traceId,
      project_name: OPIK_PROJECT,
      name: `${data.method} ${data.path}`,
      start_time: startISO,
      end_time: endISO,
      input: data.requestBody,
      output: data.responseBody,
      metadata: { provider: data.provider, model, status_code: data.statusCode },
      tags: [data.provider, model],
    })

    await postOpik('/v1/private/spans', {
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
    })

    console.log(
      `[opik] trace=${traceId.slice(0, 8)} | ${data.provider} ${model} | ${usage.total_tokens || 0} tokens`,
    )
  } catch (err) {
    console.error('[opik] Failed to log trace:', err)
  }
}
