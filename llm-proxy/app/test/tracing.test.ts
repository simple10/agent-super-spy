import { describe, expect, test } from 'bun:test'
import { buildSpanAttributes, buildTracingConfig, ensureOpikTraceEndpoint, ensurePhoenixCollectorEndpoint, parseTraceExporters } from '../lib/tracing'
import type { TraceData } from '../lib/trace-data'

describe('parseTraceExporters', () => {
  test('defaults to opik when unset', () => {
    expect(parseTraceExporters(undefined)).toEqual(['opik'])
  })

  test('supports a comma-delimited list and deduplicates values', () => {
    expect(parseTraceExporters(' phoenix, opik,phoenix ')).toEqual(['phoenix', 'opik'])
  })

  test('keeps the old both alias working', () => {
    expect(parseTraceExporters('both')).toEqual(['opik', 'phoenix'])
  })
})

describe('endpoint normalization', () => {
  test('appends Phoenix OTLP traces path when given a base URL', () => {
    expect(ensurePhoenixCollectorEndpoint('http://phoenix:6006')).toBe('http://phoenix:6006/v1/traces')
  })

  test('appends Opik OTLP traces path when given the base OTLP endpoint', () => {
    expect(ensureOpikTraceEndpoint('http://opik-frontend:5173/api/v1/private/otel')).toBe(
      'http://opik-frontend:5173/api/v1/private/otel/v1/traces',
    )
  })

  test('appends the full Opik OTLP path when given a bare host', () => {
    expect(ensureOpikTraceEndpoint('http://localhost:5173')).toBe(
      'http://localhost:5173/api/v1/private/otel/v1/traces',
    )
  })
})

describe('buildTracingConfig', () => {
  test('injects the Opik project as an OTLP header', () => {
    expect(
      buildTracingConfig({
        TRACE_EXPORTERS: 'opik,phoenix',
        OPIK_PROJECT_NAME: 'proxy-opik',
        PHOENIX_PROJECT_NAME: 'proxy-phoenix',
      }),
    ).toMatchObject({
      exporters: ['opik', 'phoenix'],
      opikHeaders: { projectName: 'proxy-opik' },
      phoenixHeaders: {},
      opikProjectName: 'proxy-opik',
      phoenixProjectName: 'proxy-phoenix',
    })
  })
})

describe('buildSpanAttributes', () => {
  const data: TraceData = {
    provider: 'anthropic',
    method: 'POST',
    path: '/v1/messages',
    requestBody: {
      model: 'claude-test',
      system: 'You are a terse assistant.',
      tools: [{ name: 'get_weather', input_schema: { type: 'object' } }],
      messages: [{ role: 'user', content: 'Ping' }],
    },
    responseBody: {
      model: 'claude-test',
      usage: { input_tokens: 10, output_tokens: 5 },
      content: [{ type: 'text', text: 'Pong' }],
    },
    statusCode: 200,
    startTime: new Date('2026-03-17T18:00:00.000Z'),
    endTime: new Date('2026-03-17T18:00:01.000Z'),
  }

  test('maps proxy trace data to llm-friendly attributes for opik', () => {
    expect(buildSpanAttributes(data, 'opik')).toMatchObject({
      'openinference.span.kind': 'LLM',
      'input.value': 'Ping',
      'output.value': 'Pong',
      'llm.model_name': 'claude-test',
      'llm.provider': 'anthropic',
      'llm.token_count.total': 15,
      'http.response.status_code': 200,
    })
    expect(buildSpanAttributes(data, 'opik')).not.toHaveProperty('llm.input_messages.0.message.role')
    expect(buildSpanAttributes(data, 'opik')).not.toHaveProperty('llm.tools.0.tool.json_schema')
  })

  test('adds structured input messages and tools for phoenix', () => {
    expect(buildSpanAttributes(data, 'phoenix')).toMatchObject({
      'openinference.span.kind': 'LLM',
      'input.value': 'Ping',
      'output.value': 'Pong',
      'llm.model_name': 'claude-test',
      'llm.provider': 'anthropic',
      'llm.input_messages.0.message.role': 'system',
      'llm.input_messages.0.message.content': 'You are a terse assistant.',
      'llm.input_messages.1.message.role': 'user',
      'llm.input_messages.1.message.content': 'Ping',
      'llm.tools.0.tool.json_schema': '{"name":"get_weather","input_schema":{"type":"object"}}',
      'llm.token_count.total': 15,
      'http.response.status_code': 200,
    })
  })
})
