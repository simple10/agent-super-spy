import { resolve } from 'path'
import { pathToFileURL } from 'url'
import type { CacheHints } from '../../cache-control'

export type TransformContext = {
  cacheType: 'auto' | 'max'
}

export type TransformResult = {
  input: Record<string, unknown>
  cacheHints?: CacheHints
  disableCaching?: boolean
}

export type InputTransformer = (
  input: Record<string, unknown>,
  context: TransformContext,
) => TransformResult | Promise<TransformResult>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergeCacheHints(current: CacheHints | undefined, next: CacheHints | undefined): CacheHints | undefined {
  if (!current && !next) return undefined
  return {
    ...current,
    ...next,
    ...(next?.messages !== undefined ? { messages: next.messages } : {}),
  }
}

function parsePluginSpecs(rawSpecs: string): string[] {
  return rawSpecs
    .split(',')
    .map((spec) => spec.trim())
    .filter(Boolean)
}

function resolvePluginSpecifier(spec: string): string {
  if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
    return pathToFileURL(resolve(spec)).href
  }
  return new URL(`./input/${spec}`, import.meta.url).href
}

export async function loadInputTransformers(rawSpecs = process.env.PLUGINS_TRANSFORM_INPUT || ''): Promise<{
  transformers: InputTransformer[]
  loadedSpecs: string[]
}> {
  const specs = parsePluginSpecs(rawSpecs)
  const transformers: InputTransformer[] = []

  for (const spec of specs) {
    const mod = await import(resolvePluginSpecifier(spec))
    if (typeof mod.transformInput !== 'function') {
      throw new Error(`Input transform plugin "${spec}" must export transformInput(input, context)`)
    }
    transformers.push(mod.transformInput as InputTransformer)
  }

  return { transformers, loadedSpecs: specs }
}

const { transformers: inputTransformers, loadedSpecs: loadedInputPluginSpecs } =
  await loadInputTransformers()

export { loadedInputPluginSpecs }

export async function transformInput(
  input: Record<string, unknown>,
  context: TransformContext,
): Promise<TransformResult> {
  let currentInput = input
  let cacheHints: CacheHints | undefined
  let disableCaching = false

  for (const transformer of inputTransformers) {
    const result = await transformer(currentInput, context)
    if (!isRecord(result?.input)) {
      throw new Error('Input transform plugin must return { input, cacheHints?, disableCaching? }')
    }
    currentInput = result.input
    cacheHints = mergeCacheHints(cacheHints, result.cacheHints)
    disableCaching = disableCaching || result.disableCaching === true
  }

  return {
    input: currentInput,
    cacheHints,
    disableCaching,
  }
}
