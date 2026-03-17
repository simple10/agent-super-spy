const KNOWN_PROVIDERS: Record<string, string> = {
  anthropic: 'https://api.anthropic.com',
  openai: 'https://api.openai.com',
}

// Block private/loopback IPs and metadata endpoints to prevent SSRF
const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^localhost$/i,
  /^\[?::1\]?$/,
  /^\[?fe80:/i,
  /^\[?fc00:/i,
  /^\[?fd/i,
]

function isPrivateHost(host: string): boolean {
  return PRIVATE_PATTERNS.some(p => p.test(host))
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
    // Block private/loopback IPs to prevent SSRF
    if (isPrivateHost(prefix)) return null
    return { provider: prefix, upstream: `https://${prefix}`, path: restPath }
  }

  // Known provider routing
  const upstream = KNOWN_PROVIDERS[prefix]
  if (upstream) {
    return { provider: prefix, upstream, path: restPath }
  }

  return null
}
