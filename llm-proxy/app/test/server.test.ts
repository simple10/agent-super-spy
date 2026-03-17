import { describe, expect, test } from 'bun:test'
import { parseStreamForMetadata } from '../server'

describe('parseStreamForMetadata', () => {
  test('preserves full anthropic stream usage metadata', () => {
    const sse = [
      'event: message_start',
      'data: {"type":"message_start","message":{"id":"msg_123","type":"message","role":"assistant","model":"claude-sonnet-4-20250514","usage":{"input_tokens":44,"cache_creation_input_tokens":0,"cache_read_input_tokens":128,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":32}}}}',
      '',
      'event: content_block_start',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"o"}}',
      '',
      'event: content_block_delta',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"k"}}',
      '',
      'event: message_delta',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":4}}',
      '',
    ].join('\n')

    expect(parseStreamForMetadata(sse)).toEqual({
      _stream: true,
      id: 'msg_123',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-20250514',
      usage: {
        input_tokens: 44,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 128,
        cache_creation: {
          ephemeral_5m_input_tokens: 0,
          ephemeral_1h_input_tokens: 32,
        },
        output_tokens: 4,
      },
      stop_reason: 'end_turn',
      stop_sequence: null,
      text: 'ok',
      content: [{ type: 'text', text: 'ok' }],
    })
  })
})
