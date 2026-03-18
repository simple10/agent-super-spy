import { describe, expect, test } from 'bun:test'
import { describeCaptureChanges } from '../../app/capture/intercept-server'

describe('describeCaptureChanges', () => {
  test('returns no changes when headers and system match', () => {
    const capture = {
      method: 'POST',
      url: '/v1/messages',
      queryParams: { beta: 'true' },
      headers: {
        'anthropic-beta': 'tools-2024-01-01',
        'user-agent': 'claude-cli/2.1.77',
      },
      body: {
        system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      },
    }

    expect(describeCaptureChanges(capture, capture)).toEqual([])
  })

  test('detects header and system changes', () => {
    const previous = {
      method: 'POST',
      url: '/v1/messages',
      queryParams: {},
      headers: {
        'anthropic-beta': 'tools-2024-01-01',
        'user-agent': 'claude-cli/2.1.77',
      },
      body: {
        system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      },
    }

    const current = {
      ...previous,
      headers: {
        'anthropic-beta': 'tools-2024-03-01',
        'user-agent': 'claude-cli/2.2.00',
      },
      body: {
        system: [{ type: 'text', text: 'You are a concise assistant.' }],
      },
    }

    expect(describeCaptureChanges(previous, current)).toEqual([
      'headers.anthropic-beta: "tools-2024-01-01" -> "tools-2024-03-01"',
      'headers.user-agent: "claude-cli/2.1.77" -> "claude-cli/2.2.00"',
      'body.system: [{"text":"You are a helpful assistant.","type":"text"}] -> [{"text":"You are a concise assistant.","type":"text"}]',
    ])
  })
})
