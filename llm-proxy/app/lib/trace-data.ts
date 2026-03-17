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

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function extractTextParts(content: any): string[] {
  if (typeof content === 'string') {
    const trimmed = content.trim()
    return trimmed ? [content] : []
  }

  if (!Array.isArray(content)) return []

  const parts: string[] = []
  for (const item of content) {
    if (typeof item === 'string') {
      const trimmed = item.trim()
      if (trimmed) parts.push(item)
      continue
    }

    if (!isRecord(item)) continue

    if (typeof item.text === 'string' && item.text.trim()) {
      parts.push(item.text)
      continue
    }

    if (typeof item.content === 'string' && item.content.trim()) {
      parts.push(item.content)
    }
  }

  return parts
}

function joinTextParts(parts: string[]): string | undefined {
  const text = parts.map((part) => part.trim()).filter(Boolean).join('\n\n')
  return text || undefined
}

function extractLastUserMessage(messages: unknown[]): string | undefined {
  const userMessages: string[] = []

  for (const message of messages) {
    if (!isRecord(message)) continue

    const role = message.role ?? message.type
    if (role !== 'user' && role !== 'human') continue

    const text = joinTextParts(extractTextParts(message.content))
    if (text) userMessages.push(text)
  }

  return userMessages.at(-1)
}

function extractLastAssistantMessage(messages: unknown[]): string | undefined {
  const assistantMessages: string[] = []

  for (const message of messages) {
    if (!isRecord(message)) continue

    const role = message.role ?? message.type
    if (role !== 'assistant' && role !== 'ai') continue

    const text = joinTextParts(extractTextParts(message.content))
    if (text) assistantMessages.push(text)
  }

  return assistantMessages.at(-1)
}

export function summarizeTraceInput(input: any): string | undefined {
  if (typeof input === 'string') {
    return input.trim() ? input : undefined
  }

  if (!isRecord(input)) return undefined

  if (Array.isArray(input.messages)) {
    const message = extractLastUserMessage(input.messages)
    if (message) return message
  }

  if (Array.isArray(input.input)) {
    const message = extractLastUserMessage(input.input)
    if (message) return message

    const text = joinTextParts(extractTextParts(input.input))
    if (text) return text
  }

  for (const key of ['prompt', 'input', 'question', 'query', 'message', 'text']) {
    if (typeof input[key] === 'string' && input[key].trim()) {
      return input[key]
    }
  }

  return undefined
}

export function summarizeTraceOutput(output: any): string | undefined {
  if (typeof output === 'string') {
    return output.trim() ? output : undefined
  }

  if (!isRecord(output)) return undefined

  if (Array.isArray(output.choices)) {
    const lastChoice = output.choices.at(-1)
    if (isRecord(lastChoice)) {
      const messageText = joinTextParts(extractTextParts(lastChoice.message?.content))
      if (messageText) return messageText

      const deltaText = joinTextParts(extractTextParts(lastChoice.delta?.content))
      if (deltaText) return deltaText

      if (typeof lastChoice.text === 'string' && lastChoice.text.trim()) {
        return lastChoice.text
      }
    }
  }

  if (Array.isArray(output.content)) {
    const text = joinTextParts(extractTextParts(output.content))
    if (text) return text
  }

  if (Array.isArray(output.messages)) {
    const message = extractLastAssistantMessage(output.messages)
    if (message) return message
  }

  if (Array.isArray(output.output)) {
    const message = extractLastAssistantMessage(output.output)
    if (message) return message

    const text = joinTextParts(extractTextParts(output.output))
    if (text) return text
  }

  for (const key of ['output', 'response', 'output_text', 'text']) {
    if (typeof output[key] === 'string' && output[key].trim()) {
      return output[key]
    }
  }

  return undefined
}

export function buildLoggedInput(input: any): any {
  const summary = summarizeTraceInput(input)

  if (!summary || !isRecord(input)) {
    return input
  }

  return {
    input: summary,
    request: input,
  }
}

export function buildLoggedOutput(output: any): any {
  const summary = summarizeTraceOutput(output)

  if (!summary || !isRecord(output)) {
    return output
  }

  return {
    output: summary,
    response: output,
  }
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
