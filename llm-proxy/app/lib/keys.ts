import { readFileSync } from 'fs'

// Key config: { "local-key": { "provider": "real-key", ... }, ... }
export type KeyConfig = Record<string, Record<string, string>>

export function loadKeys(path: string): KeyConfig {
  try {
    const raw = readFileSync(path, 'utf-8')
    // Strip JSONC: single-line comments, multi-line comments, trailing commas.
    // Note: this naive regex will break if string values contain "//".
    // This is acceptable for keys.jsonc which only contains API key strings.
    const stripped = raw
      .replace(/\/\/.*$/gm, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/,\s*([}\]])/g, '$1')
    return JSON.parse(stripped)
  } catch (err: any) {
    if (err.code === 'ENOENT') return {}
    throw err
  }
}

export interface CallerAuth {
  key: string
  header: string
  format: 'plain' | 'bearer'
}

export function extractCallerAuth(headers: Headers): CallerAuth | null {
  const xApiKey = headers.get('x-api-key')
  if (xApiKey) return { key: xApiKey, header: 'x-api-key', format: 'plain' }

  const auth = headers.get('authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim()
    if (token) return { key: token, header: 'authorization', format: 'bearer' }
  }

  return null
}

export function resolveRealKey(
  callerKey: string,
  provider: string,
  config: KeyConfig,
): { realKey: string | null; isLocalKey: boolean } {
  const entry = config[callerKey]
  if (!entry) return { realKey: null, isLocalKey: false }
  const realKey = entry[provider] ?? null
  return { realKey, isLocalKey: true }
}
