import { describe, expect, test } from 'bun:test'
import { buildUpstreamHeaders, stripRespHeaders } from './headers'

describe('buildUpstreamHeaders', () => {
  test('preserves end-to-end headers and swaps bearer auth', () => {
    const req = new Request('http://localhost/test', {
      headers: {
        authorization: 'Bearer local-key',
        'content-type': 'application/json',
        'accept-encoding': 'gzip, br',
        connection: 'keep-alive',
      },
    })

    const headers = buildUpstreamHeaders(req, 'real-key', {
      header: 'authorization',
      format: 'bearer',
    })

    expect(headers.get('authorization')).toBe('Bearer real-key')
    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('accept-encoding')).toBe('gzip, br')
    expect(headers.has('connection')).toBeFalse()
  })
})

describe('stripRespHeaders', () => {
  test('removes compression and length headers from decoded upstream responses', () => {
    const upstream = new Response('decoded body', {
      headers: {
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': '123',
        'anthropic-ratelimit-requests-limit': '50',
        connection: 'keep-alive',
      },
    })

    const headers = stripRespHeaders(upstream)

    expect(headers.get('content-type')).toBe('application/json')
    expect(headers.get('anthropic-ratelimit-requests-limit')).toBe('50')
    expect(headers.has('content-encoding')).toBeFalse()
    expect(headers.has('content-length')).toBeFalse()
    expect(headers.has('connection')).toBeFalse()
  })
})

