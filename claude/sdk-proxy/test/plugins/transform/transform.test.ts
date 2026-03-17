import { describe, expect, test } from 'bun:test'
import {
  loadInputTransformers,
  transformInput,
  transformInputWithTransformers,
} from '../../../app/plugins/transform/transform'

describe('app/plugins/transform/transform', () => {
  test('auto-enables built-in cache-control behavior for cache-control routes', async () => {
    const input = {
      messages: [{ role: 'user', content: 'hello' }],
    }

    await expect(transformInput(input, { cacheType: 'auto' })).resolves.toEqual({
      cacheHints: undefined,
      disableCaching: false,
      input: {
        messages: [{ role: 'user', content: 'hello' }],
        cache_control: { type: 'ephemeral' },
      },
    })
  })

  test('does not apply built-in cache-control behavior off cache-control routes', async () => {
    const input = {
      messages: [{ role: 'user', content: 'hello' }],
    }

    await expect(transformInput(input, {})).resolves.toEqual({
      cacheHints: undefined,
      disableCaching: false,
      input,
    })
  })

  test('treats env-enabled cache-control as a built-in plugin instead of loading it twice', async () => {
    const loaded = await loadInputTransformers('cache-control,openfang')

    expect(loaded.loadedSpecs).toEqual(['cache-control', 'openfang'])
    expect(loaded.enabledBuiltInSpecs).toEqual(['cache-control'])
    expect(loaded.transformers).toHaveLength(1)
  })

  test('defaults env-enabled cache-control to auto on non-cache-control routes', async () => {
    const input = {
      messages: [{ role: 'user', content: 'hello' }],
    }
    const loaded = await loadInputTransformers('cache-control')

    await expect(transformInputWithTransformers(input, {}, loaded)).resolves.toEqual({
      cacheHints: undefined,
      disableCaching: false,
      input: {
        messages: [{ role: 'user', content: 'hello' }],
        cache_control: { type: 'ephemeral' },
      },
    })
  })
})
