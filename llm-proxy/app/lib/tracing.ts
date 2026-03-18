import { SpanKind, SpanStatusCode } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { BasicTracerProvider, BatchSpanProcessor } from '@opentelemetry/sdk-trace-base'
import {
  buildInputMessageAttributes,
  buildLoggedInput,
  buildLoggedOutput,
  buildToolAttributes,
  extractModelAndUsage,
  summarizeTraceInput,
  summarizeTraceOutput,
  type TraceData,
} from './trace-data'

const SERVICE_NAME = 'llm-proxy'
const SERVICE_VERSION = '1.0.0'

const OPENINFERENCE_PROJECT_NAME = 'openinference.project.name'
const OPENINFERENCE_SPAN_KIND = 'openinference.span.kind'

const DEFAULT_OPIK_OTEL_ENDPOINT = 'http://opik-frontend:5173/api/v1/private/otel/v1/traces'
const DEFAULT_OPIK_PROJECT = process.env.OPIK_PROJECT_NAME || 'llm-proxy'
const DEFAULT_PHOENIX_COLLECTOR_ENDPOINT = process.env.PHOENIX_COLLECTOR_ENDPOINT || 'http://phoenix:6006'
const DEFAULT_PHOENIX_PROJECT = process.env.PHOENIX_PROJECT_NAME || DEFAULT_OPIK_PROJECT

export const SUPPORTED_TRACE_EXPORTERS = ['opik', 'phoenix'] as const

export type TraceExporter = (typeof SUPPORTED_TRACE_EXPORTERS)[number]

export interface TracingConfig {
  exporters: TraceExporter[]
  opikEndpoint: string
  opikProjectName: string
  opikHeaders: Record<string, string>
  phoenixEndpoint: string
  phoenixProjectName: string
  phoenixHeaders: Record<string, string>
}

interface TracePipeline {
  exporter: TraceExporter
  endpoint: string
  provider: BasicTracerProvider
  tracer: ReturnType<BasicTracerProvider['getTracer']>
}

function jsonStringify(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseOtelHeaders(value: string | undefined): Record<string, string> {
  if (!value?.trim()) return {}

  const headers: Record<string, string> = {}
  for (const entry of value.split(',')) {
    const [rawKey, ...rawValue] = entry.split('=')
    const key = rawKey?.trim()
    const joinedValue = rawValue.join('=').trim()
    if (!key || !joinedValue) continue
    headers[key] = joinedValue
  }
  return headers
}

function withProjectHeader(headers: Record<string, string>, projectName: string): Record<string, string> {
  return headers.projectName ? headers : { ...headers, projectName }
}

export function parseTraceExporters(value = process.env.TRACE_EXPORTERS): TraceExporter[] {
  const normalized = value?.trim()
  if (!normalized) return ['opik']

  const exporters = normalized
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .flatMap((item) => (item === 'both' ? ['opik', 'phoenix'] : [item]))
    .filter((item): item is TraceExporter =>
      (SUPPORTED_TRACE_EXPORTERS as readonly string[]).includes(item),
    )

  return exporters.length > 0 ? [...new Set(exporters)] : ['opik']
}

export function ensurePhoenixCollectorEndpoint(url: string): string {
  if (url.includes('/v1/traces')) return url

  const normalized = new URL(url)
  if (!normalized.pathname.endsWith('/')) {
    normalized.pathname += '/'
  }
  normalized.pathname += 'v1/traces'
  return normalized.toString()
}

export function ensureOpikTraceEndpoint(url: string): string {
  if (url.includes('/v1/traces')) return url

  const normalized = new URL(url)
  if (normalized.pathname.endsWith('/')) {
    normalized.pathname = normalized.pathname.slice(0, -1)
  }

  if (normalized.pathname.endsWith('/api/v1/private/otel')) {
    normalized.pathname += '/v1/traces'
    return normalized.toString()
  }

  normalized.pathname = `${normalized.pathname}/api/v1/private/otel/v1/traces`.replace(/\/{2,}/g, '/')
  return normalized.toString()
}

export function buildTracingConfig(env = process.env): TracingConfig {
  const opikProjectName = env.OPIK_PROJECT_NAME || DEFAULT_OPIK_PROJECT
  const phoenixProjectName = env.PHOENIX_PROJECT_NAME || DEFAULT_PHOENIX_PROJECT

  const opikHeaders = withProjectHeader(
    {
      ...parseOtelHeaders(env.OPIK_OTEL_HEADERS),
      ...(env.OPIK_API_KEY ? { Authorization: env.OPIK_API_KEY } : {}),
      ...(env.OPIK_WORKSPACE ? { 'Comet-Workspace': env.OPIK_WORKSPACE } : {}),
    },
    opikProjectName,
  )

  const phoenixHeaders = {
    ...parseOtelHeaders(env.PHOENIX_OTEL_HEADERS),
    ...(env.PHOENIX_API_KEY ? { Authorization: `Bearer ${env.PHOENIX_API_KEY}` } : {}),
  }

  return {
    exporters: parseTraceExporters(env.TRACE_EXPORTERS),
    opikEndpoint: ensureOpikTraceEndpoint(env.OPIK_OTEL_ENDPOINT || DEFAULT_OPIK_OTEL_ENDPOINT),
    opikProjectName,
    opikHeaders,
    phoenixEndpoint: ensurePhoenixCollectorEndpoint(
      env.PHOENIX_COLLECTOR_ENDPOINT || DEFAULT_PHOENIX_COLLECTOR_ENDPOINT,
    ),
    phoenixProjectName,
    phoenixHeaders,
  }
}

export function buildSpanAttributes(
  data: TraceData,
  exporter?: TraceExporter,
): Record<string, string | number | boolean> {
  const { model, usage } = extractModelAndUsage(data.provider, data.requestBody, data.responseBody)
  const inputSummary = summarizeTraceInput(data.requestBody)
  const outputSummary = summarizeTraceOutput(data.responseBody)
  const requestJson = jsonStringify(buildLoggedInput(data.requestBody))
  const responseJson = jsonStringify(buildLoggedOutput(data.responseBody))

  return {
    [OPENINFERENCE_SPAN_KIND]: 'LLM',
    'llm.provider': data.provider,
    'llm.model_name': model,
    'http.request.method': data.method,
    'http.response.status_code': data.statusCode,
    'url.path': data.path,
    ...(inputSummary ? { 'input.value': inputSummary } : {}),
    ...(outputSummary ? { 'output.value': outputSummary } : {}),
    ...(usage.prompt_tokens !== undefined ? { 'llm.token_count.prompt': usage.prompt_tokens } : {}),
    ...(usage.completion_tokens !== undefined
      ? { 'llm.token_count.completion': usage.completion_tokens }
      : {}),
    ...(usage.total_tokens !== undefined ? { 'llm.token_count.total': usage.total_tokens } : {}),
    ...(exporter === 'phoenix' ? buildInputMessageAttributes(data.requestBody) : {}),
    ...(exporter === 'phoenix' ? buildToolAttributes(data.requestBody) : {}),
    ...(requestJson ? { 'llm-proxy.request': requestJson } : {}),
    ...(responseJson ? { 'llm-proxy.response': responseJson } : {}),
  }
}

function createTracerProvider(
  endpoint: string,
  headers: Record<string, string>,
  projectName: string,
): BasicTracerProvider {
  return new BasicTracerProvider({
    resource: resourceFromAttributes({
      'service.name': SERVICE_NAME,
      'service.version': SERVICE_VERSION,
      [OPENINFERENCE_PROJECT_NAME]: projectName,
    }),
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({
          url: endpoint,
          headers,
        }),
      ),
    ],
  })
}

const tracingConfig = buildTracingConfig()
const tracePipelines: TracePipeline[] = tracingConfig.exporters.map((exporter) => {
  const provider =
    exporter === 'phoenix'
      ? createTracerProvider(
          tracingConfig.phoenixEndpoint,
          tracingConfig.phoenixHeaders,
          tracingConfig.phoenixProjectName,
        )
      : createTracerProvider(
          tracingConfig.opikEndpoint,
          tracingConfig.opikHeaders,
          tracingConfig.opikProjectName,
        )

  return {
    exporter,
    endpoint: exporter === 'phoenix' ? tracingConfig.phoenixEndpoint : tracingConfig.opikEndpoint,
    provider,
    tracer: provider.getTracer(SERVICE_NAME, SERVICE_VERSION),
  }
})

async function flushAndIgnoreErrors(): Promise<void> {
  try {
    await flushTraces()
  } catch (err) {
    console.error('[tracing] Failed to flush traces:', err)
  }
}

process.on('beforeExit', () => {
  void flushAndIgnoreErrors()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void flushAndIgnoreErrors().finally(() => process.exit(0))
  })
}

export async function logTrace(data: TraceData): Promise<void> {
  for (const pipeline of tracePipelines) {
    const span = pipeline.tracer.startSpan(`${data.method} ${data.path}`, {
      kind: SpanKind.SERVER,
      startTime: data.startTime,
      attributes: buildSpanAttributes(data, pipeline.exporter),
    })

    if (data.error) {
      const error = new Error(data.error)
      span.recordException(error)
      span.setStatus({ code: SpanStatusCode.ERROR, message: data.error })
    } else {
      span.setStatus({ code: SpanStatusCode.OK })
    }

    span.end(data.endTime)
  }
}

export async function flushTraces(): Promise<void> {
  await Promise.all(tracePipelines.map((pipeline) => pipeline.provider.forceFlush()))
}

export function getTraceExporterSummary(value = process.env.TRACE_EXPORTERS): string {
  return parseTraceExporters(value).join(',')
}

export function getTraceTargetSummary(): string {
  return tracePipelines
    .map((pipeline) => `${pipeline.exporter}=${pipeline.endpoint}`)
    .join(' ')
}
