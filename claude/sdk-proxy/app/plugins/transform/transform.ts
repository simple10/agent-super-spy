import { resolve } from 'path'
import { pathToFileURL } from 'url'
import type { CacheHints } from './cache-control/lib'
import { transformInput as transformCacheControl } from './cache-control'

export type TransformContext = {
  cacheType?: 'auto' | 'max'
  cacheHints?: CacheHints
  disableCaching?: boolean
}

export type TransformResult = {
  input: Record<string, unknown>
  cacheHints?: CacheHints
  disableCaching?: boolean
}

export type InputTransformer = (
  input: Record<string, unknown>,
  context: TransformContext
) => TransformResult | Promise<TransformResult>

type BuiltInInputPluginName = 'cache-control'

type LoadedInputTransformers = {
  transformers: InputTransformer[]
  loadedSpecs: string[]
  enabledBuiltInSpecs: BuiltInInputPluginName[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function mergeCacheHints(
  current: CacheHints | undefined,
  next: CacheHints | undefined
): CacheHints | undefined {
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

function isBuiltInInputPlugin(spec: string): spec is BuiltInInputPluginName {
  return spec === 'cache-control'
}

function resolvePluginSpecifier(spec: string): string {
  if (spec.startsWith('/') || spec.startsWith('./') || spec.startsWith('../')) {
    return pathToFileURL(resolve(spec)).href
  }
  return new URL(`./${spec}/index.ts`, import.meta.url).href
}

export async function loadInputTransformers(
  rawSpecs = process.env.PLUGINS_TRANSFORM || ''
): Promise<LoadedInputTransformers> {
  const specs = parsePluginSpecs(rawSpecs)
  const transformers: InputTransformer[] = []
  const enabledBuiltInSpecs = new Set<BuiltInInputPluginName>()

  for (const spec of specs) {
    if (isBuiltInInputPlugin(spec)) {
      enabledBuiltInSpecs.add(spec)
      continue
    }

    const mod = await import(resolvePluginSpecifier(spec))
    if (typeof mod.transformInput !== 'function') {
      throw new Error(`Input transform plugin "${spec}" must export transformInput(input, context)`)
    }
    transformers.push(mod.transformInput as InputTransformer)
  }

  return {
    transformers,
    loadedSpecs: specs,
    enabledBuiltInSpecs: [...enabledBuiltInSpecs],
  }
}

const loadedInputTransformers = await loadInputTransformers()
const {
  transformers: inputTransformers,
  loadedSpecs: loadedInputPluginSpecs,
  enabledBuiltInSpecs,
} = loadedInputTransformers

export { loadedInputPluginSpecs }

async function runInputTransformers(
  input: Record<string, unknown>,
  context: TransformContext,
  loaded: LoadedInputTransformers
): Promise<TransformResult> {
  let currentInput = input
  let cacheHints: CacheHints | undefined
  let disableCaching = false

  for (const transformer of loaded.transformers) {
    const result = await transformer(currentInput, {
      ...context,
      cacheHints,
      disableCaching,
    })
    if (!isRecord(result?.input)) {
      throw new Error('Input transform plugin must return { input, cacheHints?, disableCaching? }')
    }
    currentInput = result.input
    cacheHints = mergeCacheHints(cacheHints, result.cacheHints)
    disableCaching = disableCaching || result.disableCaching === true
  }

  const shouldRunCacheControl =
    context.cacheType !== undefined || loaded.enabledBuiltInSpecs.includes('cache-control')
  const effectiveCacheType = context.cacheType ?? (shouldRunCacheControl ? 'auto' : undefined)

  if (shouldRunCacheControl) {
    const result = await transformCacheControl(currentInput, {
      ...context,
      cacheType: effectiveCacheType,
      cacheHints,
      disableCaching,
    })
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

export async function transformInputWithTransformers(
  input: Record<string, unknown>,
  context: TransformContext,
  loaded: LoadedInputTransformers
): Promise<TransformResult> {
  return runInputTransformers(input, context, loaded)
}

export async function transformInput(
  input: Record<string, unknown>,
  context: TransformContext
): Promise<TransformResult> {
  return runInputTransformers(input, context, loadedInputTransformers)
}
