import { describe, expect, test } from 'bun:test'
import { transformInput } from '../../../../app/plugins/transform/cache-control'

describe('cache-control transformInput', () => {
  test('applies max-route cache breakpoints using cache hints from earlier plugins', async () => {
    const input = {
      system: [
        { type: 'text', text: 'stable 1' },
        { type: 'text', text: 'stable 2' },
      ],
      tools: [{ name: 'tool-a' }, { name: 'tool-b' }],
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    }

    const result = await transformInput(input, {
      cacheType: 'max',
      cacheHints: {
        system: 0,
        tools: 1,
        messages: [2],
      },
    })

    expect(result).toEqual({
      input: {
        system: [
          { type: 'text', text: 'stable 1', cache_control: { type: 'ephemeral', ttl: '1h' } },
          { type: 'text', text: 'stable 2' },
        ],
        tools: [{ name: 'tool-a' }, { name: 'tool-b', cache_control: { type: 'ephemeral', ttl: '1h' } }],
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          {
            role: 'user',
            content: [{ type: 'text', text: 'third', cache_control: { type: 'ephemeral' } }],
          },
        ],
      },
    })
  })

  test('applies top-level cache_control on auto routes', async () => {
    const input = {
      messages: [{ role: 'user', content: 'hello' }],
    }

    await expect(transformInput(input, { cacheType: 'auto' })).resolves.toEqual({
      input: {
        messages: [{ role: 'user', content: 'hello' }],
        cache_control: { type: 'ephemeral' },
      },
    })
  })

  test('does nothing when caching was disabled by an earlier plugin', async () => {
    const input = {
      messages: [{ role: 'user', content: 'hello' }],
    }

    await expect(
      transformInput(input, {
        cacheType: 'max',
        disableCaching: true,
      }),
    ).resolves.toEqual({ input })
  })
})
