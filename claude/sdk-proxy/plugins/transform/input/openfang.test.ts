import { describe, expect, test } from 'bun:test'
import { transformInput } from './openfang'

describe('openfang transformInput', () => {
  test('moves the current date section into a final system block and hints the stable prefix', async () => {
    const result = await transformInput(
      {
        system: [
          {
            type: 'text',
            text:
              'You are a helpful AI assistant.\n\n## Current Date\nToday is Wednesday, March 11, 2026 (2026-03-11 18:27 +00:00).\n\n## Tool Call Behavior\n- Use tools when needed.',
          },
        ],
      },
      { cacheType: 'max' },
    )

    expect(result).toEqual({
      input: {
        system: [
          {
            type: 'text',
            text:
              'You are a helpful AI assistant.\n\n## Tool Call Behavior\n- Use tools when needed.',
          },
          {
            type: 'text',
            text:
              '## Current Date\nToday is Wednesday, March 11, 2026 (2026-03-11 18:27 +00:00).',
          },
        ],
      },
      cacheHints: {
        system: 0,
      },
    })
  })

  test('does not modify input for non-max cache routes', async () => {
    const input = {
      system: [
        {
          type: 'text',
          text: 'You are a helpful AI assistant.\n\n## Current Date\nToday is Wednesday, March 11, 2026.',
        },
      ],
    }

    expect(await transformInput(input, { cacheType: 'auto' })).toEqual({ input })
  })
})
