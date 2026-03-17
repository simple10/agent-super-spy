import { describe, test, expect } from 'bun:test'
import { extractCallerAuth, resolveRealKey, loadKeys } from '../lib/keys'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

describe('extractCallerAuth', () => {
  test('extracts x-api-key header', () => {
    const headers = new Headers({ 'x-api-key': 'test-key' })
    expect(extractCallerAuth(headers)).toEqual({
      key: 'test-key',
      header: 'x-api-key',
      format: 'plain',
    })
  })

  test('extracts Bearer token from authorization', () => {
    const headers = new Headers({ authorization: 'Bearer my-token' })
    expect(extractCallerAuth(headers)).toEqual({
      key: 'my-token',
      header: 'authorization',
      format: 'bearer',
    })
  })

  test('prefers x-api-key over authorization', () => {
    const headers = new Headers({
      'x-api-key': 'api-key',
      authorization: 'Bearer bearer-key',
    })
    expect(extractCallerAuth(headers)!.key).toBe('api-key')
  })

  test('returns null when no auth headers present', () => {
    const headers = new Headers({ 'content-type': 'application/json' })
    expect(extractCallerAuth(headers)).toBeNull()
  })

  test('returns null for empty x-api-key', () => {
    const headers = new Headers({ 'x-api-key': '' })
    expect(extractCallerAuth(headers)).toBeNull()
  })

  test('returns null for Bearer with no token', () => {
    const headers = new Headers({ authorization: 'Bearer ' })
    expect(extractCallerAuth(headers)).toBeNull()
  })

  test('returns null for non-Bearer authorization', () => {
    const headers = new Headers({ authorization: 'Basic abc123' })
    expect(extractCallerAuth(headers)).toBeNull()
  })
})

describe('resolveRealKey', () => {
  const config = {
    'local-key-1': {
      anthropic: 'real-anthropic-key',
      openai: 'real-openai-key',
    },
    'local-key-2': {
      anthropic: 'another-anthropic-key',
    },
  }

  test('resolves known local key for known provider', () => {
    expect(resolveRealKey('local-key-1', 'anthropic', config)).toEqual({
      realKey: 'real-anthropic-key',
      isLocalKey: true,
    })
  })

  test('returns null realKey when provider not configured for local key', () => {
    expect(resolveRealKey('local-key-2', 'openai', config)).toEqual({
      realKey: null,
      isLocalKey: true,
    })
  })

  test('returns isLocalKey false for unknown key (pass-through)', () => {
    expect(resolveRealKey('unknown-key', 'anthropic', config)).toEqual({
      realKey: null,
      isLocalKey: false,
    })
  })

  test('resolves generic hostname provider', () => {
    const cfg = {
      'my-key': { 'api.openrouter.com': 'real-openrouter-key' },
    }
    expect(resolveRealKey('my-key', 'api.openrouter.com', cfg)).toEqual({
      realKey: 'real-openrouter-key',
      isLocalKey: true,
    })
  })
})

describe('loadKeys', () => {
  test('loads valid JSONC file with comments', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-test-'))
    const path = join(dir, 'keys.jsonc')
    writeFileSync(
      path,
      `{
      // This is a comment
      "key1": {
        "anthropic": "real-key"
      }
    }`,
    )
    const config = loadKeys(path)
    expect(config).toEqual({ key1: { anthropic: 'real-key' } })
    unlinkSync(path)
  })

  test('handles trailing commas in JSONC', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-test-'))
    const path = join(dir, 'keys.jsonc')
    writeFileSync(
      path,
      `{
      "key1": {
        "anthropic": "a",
        "openai": "b",
      },
    }`,
    )
    const config = loadKeys(path)
    expect(config.key1.anthropic).toBe('a')
    expect(config.key1.openai).toBe('b')
    unlinkSync(path)
  })

  test('returns empty object for missing file', () => {
    expect(loadKeys('/nonexistent/keys.jsonc')).toEqual({})
  })

  test('throws on invalid JSON (not ENOENT)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'keys-test-'))
    const path = join(dir, 'keys.jsonc')
    writeFileSync(path, '{ invalid json }')
    expect(() => loadKeys(path)).toThrow()
    unlinkSync(path)
  })
})
