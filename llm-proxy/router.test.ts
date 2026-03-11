import { describe, test, expect } from 'bun:test'
import { resolveRoute } from './router'

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
})
