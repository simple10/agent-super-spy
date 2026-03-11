import type { TransformContext, TransformResult } from '../input'

function normalizeSystemBlockText(block: unknown): string | null {
  if (typeof block === 'string' && block.trim()) return block
  if (
    block &&
    typeof block === 'object' &&
    'type' in block &&
    (block as any).type === 'text' &&
    'text' in block &&
    typeof (block as any).text === 'string' &&
    (block as any).text.trim()
  ) {
    return (block as any).text
  }
  return null
}

function cleanupJoinedText(parts: string[]): string {
  return parts
    .filter((part) => part.trim())
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function splitCurrentDateSection(text: string): { stableText: string; dateText: string } | null {
  const match = text.match(/(^|\n\n)(## Current Date\n[\s\S]*?)(?=\n\n## |\s*$)/)
  if (!match || !match[2]) return null

  const stableText = cleanupJoinedText([
    text.slice(0, match.index).trim(),
    text.slice((match.index || 0) + match[0].length).trim(),
  ])
  const dateText = match[2].trim()

  if (!stableText || !dateText) return null
  return { stableText, dateText }
}

export async function transformInput(
  input: Record<string, unknown>,
  context: TransformContext,
): Promise<TransformResult> {
  if (context.cacheType !== 'max') {
    return { input }
  }

  const system = input.system
  if (!Array.isArray(system) || system.length === 0) {
    return { input }
  }

  for (let i = system.length - 1; i >= 0; i--) {
    const text = normalizeSystemBlockText(system[i])
    if (!text || !text.includes('## Current Date')) continue

    const split = splitCurrentDateSection(text)
    if (!split) return { input }

    const nextSystem = [...system]
    const original = nextSystem[i]
    nextSystem[i] =
      typeof original === 'string'
        ? split.stableText
        : { ...(original as Record<string, unknown>), text: split.stableText }
    nextSystem.push({ type: 'text', text: split.dateText })

    console.log(`[api] openfang transform: moved "## Current Date" into system[${nextSystem.length - 1}] and set cache hint system=${nextSystem.length - 2}`)

    return {
      input: {
        ...input,
        system: nextSystem,
      },
      cacheHints: {
        system: nextSystem.length - 2,
      },
    }
  }

  return { input }
}
