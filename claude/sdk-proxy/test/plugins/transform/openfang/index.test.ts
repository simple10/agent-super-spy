import { describe, expect, test } from 'bun:test'
import { transformInput } from '../../../../app/plugins/transform/openfang'

describe('openfang transformInput', () => {
  test('disables caching entirely for openfang prompts on max routes', async () => {
    const input = {
      system: [
        {
          type: 'text',
          text:
            'You are a helpful AI assistant.\n\n## Current Date\nToday is Wednesday, March 11, 2026 (2026-03-11 18:27 +00:00).\n\n## Tool Call Behavior\n- Use tools when needed.',
        },
      ],
    }

    const result = await transformInput(
      input,
      { cacheType: 'max' },
    )

    expect(result).toEqual({
      input,
      disableCaching: true,
    })
  })

  test('disables caching entirely for openfang prompts on auto routes too', async () => {
    const input = {
      system: [
        {
          type: 'text',
          text: 'You are a helpful AI assistant.\n\n## Current Date\nToday is Wednesday, March 11, 2026.',
        },
      ],
    }

    expect(await transformInput(input, { cacheType: 'auto' })).toEqual({
      input,
      disableCaching: true,
    })
  })

  test('does not modify non-openfang input', async () => {
    const input = {
      system: [{ type: 'text', text: 'You are a different assistant.' }],
    }

    expect(await transformInput(input, { cacheType: 'max' })).toEqual({ input })
  })
})
