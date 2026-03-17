import { describe, test, expect } from 'bun:test'
import { resolveRoute } from '../lib/router'

describe('resolveRoute', () => {
  test('routes anthropic provider', () => {
    expect(resolveRoute('/anthropic/v1/messages')).toEqual({
      provider: 'anthropic',
      upstream: 'https://api.anthropic.com',
      path: '/v1/messages',
    })
  })

  test('routes openai provider', () => {
    expect(resolveRoute('/openai/v1/chat/completions')).toEqual({
      provider: 'openai',
      upstream: 'https://api.openai.com',
      path: '/v1/chat/completions',
    })
  })

  test('routes generic hostname with dot', () => {
    expect(resolveRoute('/api.openrouter.com/v1/messages')).toEqual({
      provider: 'api.openrouter.com',
      upstream: 'https://api.openrouter.com',
      path: '/v1/messages',
    })
  })

  test('routes deeply nested generic path', () => {
    expect(resolveRoute('/api.example.com/v2/some/deep/path')).toEqual({
      provider: 'api.example.com',
      upstream: 'https://api.example.com',
      path: '/v2/some/deep/path',
    })
  })

  test('returns null for unknown provider without dot', () => {
    expect(resolveRoute('/unknown/v1/test')).toBeNull()
  })

  test('returns null for empty path', () => {
    expect(resolveRoute('/')).toBeNull()
  })

  test('handles provider-only path', () => {
    expect(resolveRoute('/anthropic')).toEqual({
      provider: 'anthropic',
      upstream: 'https://api.anthropic.com',
      path: '/',
    })
  })

  test('preserves query-free path segments', () => {
    expect(resolveRoute('/openai/v1/models')).toEqual({
      provider: 'openai',
      upstream: 'https://api.openai.com',
      path: '/v1/models',
    })
  })

  test('is case-sensitive (uppercase returns null)', () => {
    expect(resolveRoute('/Anthropic/v1/messages')).toBeNull()
  })

  test('handles double slashes via filter(Boolean)', () => {
    expect(resolveRoute('//anthropic/v1/messages')).toEqual({
      provider: 'anthropic',
      upstream: 'https://api.anthropic.com',
      path: '/v1/messages',
    })
  })

  // SSRF protection tests
  test('blocks localhost', () => {
    expect(resolveRoute('/localhost/something')).toBeNull()
  })

  test('blocks 127.x loopback', () => {
    expect(resolveRoute('/127.0.0.1/latest/meta-data')).toBeNull()
  })

  test('blocks AWS metadata endpoint', () => {
    expect(resolveRoute('/169.254.169.254/latest/meta-data')).toBeNull()
  })

  test('blocks RFC 1918 10.x', () => {
    expect(resolveRoute('/10.0.0.1/api')).toBeNull()
  })

  test('blocks RFC 1918 172.16-31.x', () => {
    expect(resolveRoute('/172.16.0.1/api')).toBeNull()
    expect(resolveRoute('/172.31.255.255/api')).toBeNull()
  })

  test('blocks RFC 1918 192.168.x', () => {
    expect(resolveRoute('/192.168.1.1/api')).toBeNull()
  })

  test('allows valid public hostnames', () => {
    expect(resolveRoute('/api.openrouter.com/v1/messages')).not.toBeNull()
    expect(resolveRoute('/api.example.com/v1/test')).not.toBeNull()
  })
})
