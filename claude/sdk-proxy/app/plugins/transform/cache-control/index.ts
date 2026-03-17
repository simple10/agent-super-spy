import { applyCacheControlMax, CACHE_5M } from './lib'
import type { TransformContext, TransformResult } from '../transform'

export async function transformInput(
  input: Record<string, unknown>,
  context: TransformContext,
): Promise<TransformResult> {
  if (!context.cacheType || context.disableCaching) {
    return { input }
  }

  if (context.cacheType === 'max') {
    const applied = applyCacheControlMax(input, context.cacheHints)
    if (applied.changes.length > 0) {
      console.log(`[api] Added cache_control breakpoints: ${applied.changes.join(', ')}`)
    }
    return { input: applied.body }
  }

  if (!input.cache_control) {
    console.log('[api] Added top-level cache_control (auto)')
    return {
      input: {
        ...input,
        cache_control: CACHE_5M,
      },
    }
  }

  return { input }
}
