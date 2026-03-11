export const CACHE_1H = { type: 'ephemeral', ttl: '1h' } as const
export const CACHE_5M = { type: 'ephemeral' } as const

export type CacheHints = {
  system?: number
  tools?: number
  messages?: number[]
}

type CacheControlResult = {
  body: Record<string, unknown>
  changes: string[]
}

export function hasCacheControl(block: any, expected: typeof CACHE_1H | typeof CACHE_5M): boolean {
  const cc = block?.cache_control
  if (!cc || cc.type !== 'ephemeral') return false
  if ('ttl' in expected) return cc.ttl === expected.ttl
  return !cc.ttl
}

function isValidIndex(length: number, index: unknown): index is number {
  return Number.isInteger(index) && (index as number) >= 0 && (index as number) < length
}

function defaultMessageBreakpointIndices(length: number): number[] {
  if (length <= 0) return []
  if (length === 1) return [0]
  if (length === 2) return [0]
  return [length - 2, length - 3]
}

function normalizeMessageBreakpointIndices(length: number, hinted?: number[]): number[] {
  const raw = hinted ?? defaultMessageBreakpointIndices(length)
  const indices = raw.filter((index): index is number => isValidIndex(length, index))
  return [...new Set(indices)]
}

function addMessageCacheBreakpoint(
  result: Record<string, unknown>,
  changes: string[],
  index: number,
) {
  const msg = (result.messages as any[])[index]
  if (Array.isArray(msg.content) && msg.content.length > 0) {
    const lastBlock = msg.content[msg.content.length - 1]
    if (!hasCacheControl(lastBlock, CACHE_5M)) {
      const content = [...msg.content]
      content[content.length - 1] = { ...content[content.length - 1], cache_control: CACHE_5M }
      ;(result.messages as any[])[index] = { ...msg, content }
      changes.push(`messages[${index}] (5m)`)
    }
    return
  }

  if (typeof msg.content === 'string') {
    ;(result.messages as any[])[index] = {
      ...msg,
      content: [{ type: 'text', text: msg.content, cache_control: CACHE_5M }],
    }
    changes.push(`messages[${index}] (5m)`)
  }
}

export function applyCacheControlMax(
  body: Record<string, unknown>,
  hints?: CacheHints,
): CacheControlResult {
  const result = { ...body }
  const changes: string[] = []

  const sys = result.system as any[]
  if (Array.isArray(sys) && sys.length > 0) {
    const systemIndex = isValidIndex(sys.length, hints?.system) ? hints!.system : sys.length - 1
    if (!hasCacheControl(sys[systemIndex], CACHE_1H)) {
      result.system = [...sys]
      ;(result.system as any[])[systemIndex] = {
        ...sys[systemIndex],
        cache_control: CACHE_1H,
      }
      changes.push(`system[${systemIndex}] (1h)`)
    }
  }

  const tools = result.tools as any[]
  if (Array.isArray(tools) && tools.length > 0) {
    const toolsIndex = isValidIndex(tools.length, hints?.tools) ? hints!.tools : tools.length - 1
    if (!hasCacheControl(tools[toolsIndex], CACHE_1H)) {
      result.tools = [...tools]
      ;(result.tools as any[])[toolsIndex] = {
        ...tools[toolsIndex],
        cache_control: CACHE_1H,
      }
      changes.push(`tools[${toolsIndex}] (1h)`)
    }
  }

  const msgs = result.messages as any[]
  if (Array.isArray(msgs) && msgs.length > 0) {
    result.messages = msgs.map((m: any) => ({ ...m }))
    for (const index of normalizeMessageBreakpointIndices(msgs.length, hints?.messages)) {
      addMessageCacheBreakpoint(result, changes, index)
    }
  }

  return { body: result, changes }
}
