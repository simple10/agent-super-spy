const KNOWN_PROVIDERS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
}

export interface Route {
  provider: string
  upstream: string
  path: string
}

export function resolveRoute(pathname: string): Route | null {
  const segments = pathname.split('/').filter(Boolean)
  if (segments.length === 0) return null

  const prefix = segments[0]
  const restPath = segments.length > 1 ? '/' + segments.slice(1).join('/') : '/'

  // Generic URL routing: if prefix contains a dot, treat as hostname
  if (prefix.includes('.')) {
    return { provider: prefix, upstream: `https://${prefix}`, path: restPath }
  }

  // Known provider routing
  const upstream = KNOWN_PROVIDERS[prefix]
  if (upstream) {
    return { provider: prefix, upstream, path: restPath }
  }

  return null
}
