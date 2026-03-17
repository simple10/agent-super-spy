import { query } from '@anthropic-ai/claude-agent-sdk'

console.log('[capture] Sending test query through SDK...')

try {
  for await (const msg of query({
    prompt: 'API-TEST',
    options: {
      maxTurns: 1,
      tools: [],
      persistSession: false,
    },
  })) {
    if (msg.type === 'result') {
      console.log('[capture] SDK query complete.')
    }
  }
} catch (err: any) {
  // The SDK may error due to the fake response — that's fine, we already captured
  console.log(`[capture] SDK finished (${err?.message ?? 'ok'})`)
}

console.log('[capture] Done.')
process.exit(0)
