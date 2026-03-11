import { describe, expect, test } from 'bun:test'
import { applyCacheControlMax } from './cache-control'

describe('applyCacheControlMax', () => {
  test('uses hinted system and message breakpoints when provided', () => {
    const result = applyCacheControlMax(
      {
        system: [
          { type: 'text', text: 'stable 1' },
          { type: 'text', text: 'stable 2' },
          { type: 'text', text: 'volatile date' },
        ],
        tools: [{ name: 'tool-a' }, { name: 'tool-b' }],
        messages: [
          { role: 'user', content: 'first' },
          { role: 'assistant', content: 'second' },
          { role: 'user', content: 'third' },
        ],
      },
      {
        system: 1,
        tools: 0,
        messages: [2],
      },
    )

    expect(result.body).toMatchObject({
      system: [
        { type: 'text', text: 'stable 1' },
        { type: 'text', text: 'stable 2', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { type: 'text', text: 'volatile date' },
      ],
      tools: [
        { name: 'tool-a', cache_control: { type: 'ephemeral', ttl: '1h' } },
        { name: 'tool-b' },
      ],
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        {
          role: 'user',
          content: [{ type: 'text', text: 'third', cache_control: { type: 'ephemeral' } }],
        },
      ],
    })

    expect(result.changes).toEqual(['system[1] (1h)', 'tools[0] (1h)', 'messages[2] (5m)'])
  })

  test('falls back to default cache breakpoints when no hints are provided', () => {
    const result = applyCacheControlMax({
      system: [{ type: 'text', text: 'stable' }],
      tools: [{ name: 'tool-a' }],
      messages: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
        { role: 'user', content: 'third' },
      ],
    })

    expect(result.body).toMatchObject({
      system: [{ type: 'text', text: 'stable', cache_control: { type: 'ephemeral', ttl: '1h' } }],
      tools: [{ name: 'tool-a', cache_control: { type: 'ephemeral', ttl: '1h' } }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'first', cache_control: { type: 'ephemeral' } }],
        },
        {
          role: 'assistant',
          content: [{ type: 'text', text: 'second', cache_control: { type: 'ephemeral' } }],
        },
        { role: 'user', content: 'third' },
      ],
    })

    expect(result.changes).toEqual(['system[0] (1h)', 'tools[0] (1h)', 'messages[1] (5m)', 'messages[0] (5m)'])
  })
})
