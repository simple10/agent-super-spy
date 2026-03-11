import { describe, expect, test } from 'bun:test'
import {
  buildLoggedInput,
  buildLoggedOutput,
  extractModelAndUsage,
  generateUuidV7,
  summarizeTraceInput,
  summarizeTraceOutput,
} from './opik'

describe('generateUuidV7', () => {
  test('creates an RFC 9562 UUIDv7', () => {
    const date = new Date('2026-03-11T17:20:00.123Z')
    const id = generateUuidV7(date)
    const bytes = id.replace(/-/g, '')
    const expectedPrefix = date.getTime().toString(16).padStart(12, '0')

    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(bytes.slice(0, 12)).toBe(expectedPrefix)
  })
})

describe('extractModelAndUsage', () => {
  test('normalizes Anthropic usage fields', () => {
    expect(
      extractModelAndUsage(
        'anthropic',
        { model: 'claude-test' },
        { usage: { input_tokens: 10, output_tokens: 4 } },
      ),
    ).toEqual({
      model: 'claude-test',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 4,
        total_tokens: 14,
      },
    })
  })
})

describe('summarizeTraceInput', () => {
  test('prefers the last user message over system content', () => {
    expect(
      summarizeTraceInput({
        system: 'You are a terse assistant.',
        messages: [
          { role: 'user', content: 'First question' },
          { role: 'assistant', content: 'First answer' },
          { role: 'user', content: [{ type: 'text', text: 'Reply with the single word ok.' }] },
        ],
      }),
    ).toBe('Reply with the single word ok.')
  })
})

describe('summarizeTraceOutput', () => {
  test('extracts Anthropic text content', () => {
    expect(
      summarizeTraceOutput({
        id: 'msg_123',
        content: [{ type: 'text', text: 'ok' }],
      }),
    ).toBe('ok')
  })

  test('extracts text from parsed streamed responses', () => {
    expect(
      summarizeTraceOutput({
        _stream: true,
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 3, output_tokens: 12 },
        text: 'streamed answer',
      }),
    ).toBe('streamed answer')
  })
})

describe('buildLoggedInput', () => {
  test('wraps structured requests with an input summary for Opik previews', () => {
    expect(
      buildLoggedInput({
        system: 'You are a terse assistant.',
        messages: [{ role: 'user', content: 'Ping' }],
      }),
    ).toEqual({
      input: 'Ping',
      request: {
        system: 'You are a terse assistant.',
        messages: [{ role: 'user', content: 'Ping' }],
      },
    })
  })
})

describe('buildLoggedOutput', () => {
  test('wraps structured responses with an output summary for Opik previews', () => {
    expect(
      buildLoggedOutput({
        _stream: true,
        model: 'claude-sonnet-4-6',
        text: 'Sunny and 58F.',
      }),
    ).toEqual({
      output: 'Sunny and 58F.',
      response: {
        _stream: true,
        model: 'claude-sonnet-4-6',
        text: 'Sunny and 58F.',
      },
    })
  })
})
