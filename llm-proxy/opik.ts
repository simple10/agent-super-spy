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
