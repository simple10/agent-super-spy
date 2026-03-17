import type { TransformContext, TransformResult } from '../transform'

const OPENFANG_SYSTEM_MARKER = 'You are a helpful AI assistant.\n\n## Current Date'

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
  const system = input.system
  if (!Array.isArray(system) || system.length === 0) {
    return { input }
  }

  for (let i = system.length - 1; i >= 0; i--) {
    const text = normalizeSystemBlockText(system[i])
    if (!text || !text.includes(OPENFANG_SYSTEM_MARKER)) continue

    // As of 2026-03-11, OpenFang system prompts are still unstable between turns.
    // The current-date section changes every turn, but more importantly the same
    // cached system block also embeds dynamic workspace and memory context whose
    // ordering/content changes between turns (for example Workspace Context file
    // ordering and Recalled memories content). That makes Anthropic cache reads
    // miss even after stripping the timestamp.
    //
    // We are intentionally NOT rewriting the prompt structure right now because
    // we don't want to risk subtly changing OpenFang behavior. Anthropic prompt
    // caching is cumulative: a later messages breakpoint still includes the full
    // tools -> system -> messages prefix, so merely disabling the explicit system
    // breakpoint does not help. Until OpenFang fixes the prompt upstream, the
    // safest temporary behavior is to disable caching entirely for detected
    // OpenFang requests.
    //
    // The date-splitting code below is kept for reference because it may still be
    // useful once the upstream prompt becomes stable enough to safely transform.
    //
    // const split = splitCurrentDateSection(text)
    // if (split) {
    //   const nextSystem = [...system]
    //   const original = nextSystem[i]
    //   nextSystem[i] =
    //     typeof original === 'string'
    //       ? split.stableText
    //       : { ...(original as Record<string, unknown>), text: split.stableText }
    //   nextSystem.push({ type: 'text', text: split.dateText })
    // }

    console.log(
      '[api] openfang transform: detected unstable upstream system prompt; disabling caching for this request',
    )

    return {
      input,
      disableCaching: true,
    }
  }

  return { input }
}
