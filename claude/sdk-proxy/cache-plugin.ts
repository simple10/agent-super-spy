import { transformInput as transformViaPlugins, type TransformContext } from './plugins/transform/input'

export type { TransformContext } from './plugins/transform/input'
export type { CacheHints } from './cache-control'

export async function transformInput(
  input: Record<string, unknown>,
  context: TransformContext,
) {
  return transformViaPlugins(input, context)
}
