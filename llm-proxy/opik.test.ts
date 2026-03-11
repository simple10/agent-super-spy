import { describe, expect, test } from 'bun:test'
import { extractModelAndUsage, generateUuidV7 } from './opik'

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
