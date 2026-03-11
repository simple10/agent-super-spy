import { query, type SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { readFileSync } from 'fs'

let sessionStarted = false

function getApiKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  try {
    const creds = JSON.parse(readFileSync('/credentials/.credentials.json', 'utf-8'))
    return creds?.claudeAiOauth?.accessToken ?? null
  } catch {
    return null
  }
}

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Claude SDK Chat</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; height: 100vh; display: flex; flex-direction: column; background: #f5f5f5; }
  header { background: #1a1a2e; color: #fff; padding: 12px 20px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
  header h1 { font-size: 18px; font-weight: 600; }
  header .actions { display: flex; gap: 8px; align-items: center; }
  header button { background: #e94560; color: #fff; border: none; padding: 6px 14px; border-radius: 4px; cursor: pointer; font-size: 13px; }
  header button:hover { background: #c73e54; }
  header button.secondary { background: #3a3a5e; }
  header button.secondary:hover { background: #4a4a7e; }
  .modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 100; justify-content: center; align-items: center; }
  .modal-overlay.open { display: flex; }
  .modal { background: #fff; border-radius: 12px; padding: 20px; max-width: 600px; width: 90%; max-height: 70vh; overflow-y: auto; }
  .modal h2 { font-size: 16px; margin-bottom: 12px; color: #1a1a2e; }
  .modal .close-btn { float: right; background: none; border: none; font-size: 20px; cursor: pointer; color: #666; padding: 0 4px; }
  .modal .close-btn:hover { color: #000; }
  .model-list { list-style: none; }
  .model-list li { padding: 10px 12px; border-bottom: 1px solid #eee; font-size: 13px; }
  .model-list li:last-child { border-bottom: none; }
  .model-id { font-weight: 600; color: #1a1a2e; }
  .model-meta { color: #888; font-size: 12px; margin-top: 2px; }
  .model-loading { text-align: center; padding: 20px; color: #888; }
  .model-error { text-align: center; padding: 20px; color: #c00; }
  header a { color: #8888cc; text-decoration: none; font-size: 13px; }
  header a:hover { color: #aaaaee; }
  #messages { flex: 1; overflow-y: auto; padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .msg { max-width: 80%; padding: 10px 14px; border-radius: 12px; line-height: 1.5; white-space: pre-wrap; word-wrap: break-word; font-size: 14px; }
  .msg.user { align-self: flex-end; background: #1a1a2e; color: #fff; border-bottom-right-radius: 4px; }
  .msg.assistant { align-self: flex-start; background: #fff; color: #1a1a2e; border: 1px solid #ddd; border-bottom-left-radius: 4px; }
  .msg.system { align-self: center; background: #eee; color: #666; font-size: 12px; border-radius: 8px; padding: 6px 12px; }
  .msg.error { align-self: center; background: #fee; color: #c00; font-size: 12px; border-radius: 8px; padding: 6px 12px; }
  #input-area { padding: 12px 20px; background: #fff; border-top: 1px solid #ddd; display: flex; gap: 8px; flex-shrink: 0; }
  #input-area input { flex: 1; padding: 10px 14px; border: 1px solid #ddd; border-radius: 8px; font-size: 14px; outline: none; }
  #input-area input:focus { border-color: #1a1a2e; }
  #input-area button { background: #1a1a2e; color: #fff; border: none; padding: 10px 20px; border-radius: 8px; cursor: pointer; font-size: 14px; }
  #input-area button:disabled { opacity: 0.5; cursor: not-allowed; }
  .typing { opacity: 0.6; }
</style>
</head>
<body>
<header>
  <h1>Claude SDK Chat</h1>
  <div class="actions">
    <a href="http://localhost:8081/?token=${process.env.MITMPROXY_WEB_PASSWORD ?? 'mitmpass'}" target="_blank">Proxy UI</a>
    <button class="secondary" onclick="showModels()">Models</button>
    <button onclick="newSession()">New Session</button>
  </div>
</header>
<div class="modal-overlay" id="models-modal" onclick="if(event.target===this)closeModels()">
  <div class="modal">
    <button class="close-btn" onclick="closeModels()">&times;</button>
    <h2>Available Models</h2>
    <div id="models-content"><div class="model-loading">Click to load models...</div></div>
  </div>
</div>
<div id="messages"></div>
<div id="input-area">
  <input id="input" type="text" placeholder="Type a message..." autocomplete="off" />
  <button id="send" onclick="sendMessage()">Send</button>
</div>
<script>
const messages = document.getElementById("messages");
const input = document.getElementById("input");
const sendBtn = document.getElementById("send");
let streaming = false;

input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !streaming) sendMessage();
});

function addMsg(role, text) {
  const div = document.createElement("div");
  div.className = "msg " + role;
  div.textContent = text;
  messages.appendChild(div);
  messages.scrollTop = messages.scrollHeight;
  return div;
}

function setStreaming(v) {
  streaming = v;
  sendBtn.disabled = v;
  input.disabled = v;
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text || streaming) return;
  input.value = "";
  addMsg("user", text);
  setStreaming(true);

  const assistantDiv = addMsg("assistant", "");
  assistantDiv.classList.add("typing");
  let fullText = "";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: text }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split("\\n");
      buf = lines.pop();

      let eventType = "";
      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7);
        } else if (line.startsWith("data: ") && eventType) {
          const data = JSON.parse(line.slice(6));
          if (eventType === "delta") {
            fullText += data.text;
            assistantDiv.textContent = fullText;
            messages.scrollTop = messages.scrollHeight;
          } else if (eventType === "result") {
            if (data.result && !fullText) {
              fullText = data.result;
              assistantDiv.textContent = fullText;
            }
            addMsg("system", "Cost: $" + (data.cost?.toFixed(6) ?? "?") + " | Turns: " + (data.turns ?? "?"));
          } else if (eventType === "error") {
            addMsg("error", data.message);
          }
          eventType = "";
        }
      }
    }
  } catch (err) {
    addMsg("error", "Connection error: " + err.message);
  }

  assistantDiv.classList.remove("typing");
  if (!fullText) assistantDiv.remove();
  setStreaming(false);
}

async function newSession() {
  if (streaming) return;
  try {
    await fetch("/api/reset", { method: "POST" });
    messages.innerHTML = "";
    addMsg("system", "New session started");
  } catch (err) {
    addMsg("error", "Failed to reset: " + err.message);
  }
}

async function showModels() {
  const modal = document.getElementById("models-modal");
  const content = document.getElementById("models-content");
  modal.classList.add("open");
  content.innerHTML = '<div class="model-loading">Loading models...</div>';
  try {
    const res = await fetch("/api/models");
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const models = data.data || [];
    if (!models.length) {
      content.innerHTML = '<div class="model-loading">No models found.</div>';
      return;
    }
    models.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    content.innerHTML = '<ul class="model-list">' + models.map(m => {
      const created = m.created_at ? new Date(m.created_at).toLocaleDateString() : "";
      return '<li><div class="model-id">' + m.id + '</div>'
        + '<div class="model-meta">' + [m.display_name, created].filter(Boolean).join(" · ") + '</div></li>';
    }).join("") + '</ul>';
  } catch (err) {
    content.innerHTML = '<div class="model-error">Failed to load models: ' + err.message + '</div>';
  }
}

function closeModels() {
  document.getElementById("models-modal").classList.remove("open");
}

addMsg("system", "Ready. Type a message to start chatting.");
</script>
</body>
</html>`

const server = Bun.serve({
  port: 3000,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/' && req.method === 'GET') {
      return new Response(HTML, {
        headers: { 'Content-Type': 'text/html' },
      })
    }

    if (url.pathname === '/api/chat' && req.method === 'POST') {
      const body = (await req.json()) as { message: string }
      const message = body.message?.trim()
      if (!message) {
        return new Response(JSON.stringify({ error: 'empty message' }), {
          status: 400,
        })
      }

      const stream = new ReadableStream({
        async start(controller) {
          const encoder = new TextEncoder()
          const send = (event: string, data: unknown) => {
            controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
          }

          try {
            const q = query({
              prompt: message,
              options: {
                continue: sessionStarted,
                maxTurns: 1,
                tools: [],
                includePartialMessages: true,
              },
            })

            sessionStarted = true

            for await (const msg of q) {
              if (msg.type === 'stream_event') {
                const event = msg.event as Record<string, unknown>
                if (event.type === 'content_block_delta') {
                  const delta = event.delta as Record<string, unknown>
                  if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
                    send('delta', { text: delta.text })
                  }
                }
              } else if (msg.type === 'result') {
                const result = msg as SDKMessage & { type: 'result' }
                send('result', {
                  cost: (result as any).total_cost_usd,
                  turns: (result as any).num_turns,
                  result: (result as any).result,
                  isError: (result as any).is_error,
                })
              }
            }
          } catch (err: any) {
            send('error', { message: err?.message ?? String(err) })
          }

          controller.close()
        },
      })

      return new Response(stream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    if (url.pathname === '/api/models' && req.method === 'GET') {
      const apiKey = getApiKey()
      if (!apiKey) {
        return new Response(JSON.stringify({ error: 'No API key configured' }), {
          status: 500,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      try {
        const resp = await fetch('https://api.anthropic.com/v1/models', {
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        })
        const data = await resp.json()
        return new Response(JSON.stringify(data), {
          status: resp.status,
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (err: any) {
        return new Response(JSON.stringify({ error: err?.message ?? String(err) }), {
          status: 502,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    if (url.pathname === '/api/reset' && req.method === 'POST') {
      sessionStarted = false
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    return new Response('Not found', { status: 404 })
  },
})

console.log(`Chat server running on http://localhost:${server.port}`)
console.log(`HTTPS_PROXY: ${process.env.HTTPS_PROXY ?? '(not set)'}`)
console.log(`NODE_EXTRA_CA_CERTS: ${process.env.NODE_EXTRA_CA_CERTS ?? '(not set)'}`)
