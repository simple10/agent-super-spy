const REQUEST_SKIP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
  'proxy-authorization',
  'proxy-authenticate',
])

const RESPONSE_SKIP_HEADERS = new Set([
  ...REQUEST_SKIP_HEADERS,
  'content-encoding',
  'content-length',
])

export function buildUpstreamHeaders(
  req: Request,
  realKey: string | null,
  callerAuth: { header: string; format: 'bearer' | 'plain' } | null,
): Headers {
  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (REQUEST_SKIP_HEADERS.has(key.toLowerCase())) return
    headers.set(key, value)
  })

  if (realKey && callerAuth) {
    if (callerAuth.format === 'bearer') {
      headers.set('authorization', `Bearer ${realKey}`)
    } else {
      headers.set(callerAuth.header, realKey)
    }
  }

  return headers
}

export function stripRespHeaders(upstream: Response): Headers {
  const headers = new Headers()
  upstream.headers.forEach((value, key) => {
    if (RESPONSE_SKIP_HEADERS.has(key.toLowerCase())) return
    headers.set(key, value)
  })
  return headers
}

