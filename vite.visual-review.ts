import { execFile, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { Plugin, ViteDevServer } from 'vite'

// Dev-only visual review backend (Agentation + tmux). Ported from the Next.js API routes in medycznelekcje.pl#151:
//   POST /api/dev/visual-review/notify  types a message into the tmux pane running Claude Code and presses Enter
//   GET  /api/dev/visual-review/chat    chat log shown in the panel
//   POST /api/dev/visual-review/chat    agent reply (Claude posts it via curl)
//   POST /api/dev/visual-review/upload  stores a pasted screenshot in the OS temp dir and returns its path
// Active only with `vite` dev server and VITE_VISUAL_REVIEW=1. Nothing from the request reaches a shell: tmux runs via
// execFile with the text as a single argument.

const run = promisify(execFile)

const BASE = '/api/dev/visual-review'
const DEFAULT_MESSAGE = 'Sprawdź nowe adnotacje Agentation i zrealizuj je.'
const MAX_MESSAGE = 2000
const MAX_REPLY = 4000
const MAX_MESSAGES = 100
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const PANE_ID = /^%\d{1,6}$/
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

type ChatMessage = { id: string; role: 'human' | 'agent'; content: string; timestamp: number }

type Env = Record<string, string | undefined>

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer | null> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) return null
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const buf = await readBody(req, 64 * 1024)
  try {
    const value: unknown = JSON.parse(buf?.toString('utf8') ?? '')
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// Browser requests from another site carry a foreign Origin / Sec-Fetch-Site, which a page cannot forge.
function fromLocalPage(req: IncomingMessage, requireOrigin: boolean): boolean {
  const origin = req.headers.origin
  if (origin === undefined) return !requireOrigin
  if (!LOCAL_ORIGIN.test(origin)) return false
  const site = req.headers['sec-fetch-site']
  return !site || site === 'same-origin'
}

function sanitize(text: string): string {
  // Keep newlines and tabs (indentation); strip other control chars (incl. ESC). Text is pasted as a bracketed paste,
  // so newlines do not submit the message early.
  return text
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]+/g, ' ')
    .replace(/^\s*\n/, '')
    .trimEnd()
    .slice(0, MAX_MESSAGE)
}

function detectExt(b: Uint8Array): 'png' | 'jpg' | 'webp' | null {
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  const tag = (o: number) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3])
  if (b.length > 12 && tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'webp'
  return null
}

// Starts agentation-mcp together with `npm run dev`, on the port from VITE_AGENTATION_ENDPOINT. CORS gets the real Vite
// origin once the dev server listens (so a fallback port like 5174 still works). If something already answers on that
// port (e.g. `npm run agentation` in another terminal), it is reused instead.
function startAgentation(server: ViteDevServer, env: Env) {
  let port: number
  try {
    const url = new URL(env.VITE_AGENTATION_ENDPOINT ?? '')
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return
    port = Number(url.port || 80)
  } catch {
    return
  }
  const log = (msg: string) => server.config.logger.info(`[agentation] ${msg}`, { timestamp: true })

  server.httpServer?.once('listening', async () => {
    const running = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(1000) })
      .then((r) => r.ok)
      .catch(() => false)
    if (running) return log(`already running on :${port}, reusing`)

    const address = server.httpServer?.address()
    const vitePort = typeof address === 'object' && address ? address.port : 5173
    const child = spawn(
      process.execPath,
      [join(server.config.root, 'node_modules/agentation-mcp/dist/cli.js'), 'server', '--port', String(port)],
      {
        env: { ...process.env, AGENTATION_CORS_ORIGINS: `http://localhost:${vitePort},http://127.0.0.1:${vitePort}` },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    )
    // Request log ([HTTP] lines) is noise; keep everything else (startup errors, port conflicts).
    child.stderr?.on('data', (d: Buffer) => {
      const lines = d.toString().split('\n').filter((l) => l.trim() && !l.includes('[HTTP]'))
      if (lines.length) server.config.logger.warn(`[agentation] ${lines.join('\n')}`)
    })
    child.on('exit', (code) => code && log(`exited with code ${code}`))
    log(`started on :${port}`)

    // Vite does not close the HTTP server on Ctrl+C / kill, so also stop the child on process signals.
    const stop = () => child.kill()
    server.httpServer?.once('close', stop)
    process.once('exit', stop)
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const)
      process.once(signal, () => {
        stop()
        process.exit()
      })
  })
}

export function visualReview(env: Env): Plugin {
  const chat: ChatMessage[] = []
  const addChat = (role: ChatMessage['role'], content: string) => {
    chat.push({ id: randomUUID(), role, content, timestamp: Date.now() })
    if (chat.length > MAX_MESSAGES) chat.splice(0, chat.length - MAX_MESSAGES)
  }

  async function notify(req: IncomingMessage, res: ServerResponse) {
    if (!fromLocalPage(req, true)) return json(res, 403, { error: 'origin' })

    const body = await readJson(req)
    const custom = typeof body.message === 'string' ? sanitize(body.message) : ''
    if (typeof body.message === 'string' && !custom) return json(res, 400, { error: 'pusta wiadomość' })
    const message = custom || DEFAULT_MESSAGE

    const pane = env.AGENTATION_TMUX_PANE ?? ''
    if (!PANE_ID.test(pane)) return json(res, 503, { error: 'AGENTATION_TMUX_PANE nieustawiony (np. %43)' })

    // A custom message gets a one-line reply hint so Claude answers into the panel chat.
    const replyUrl = `http://${req.headers.host}${BASE}/chat`
    const text = custom
      ? `${message}\n[Odpowiedz na to w panelu czatu: curl -s -X POST ${replyUrl} -H 'Content-Type: application/json' -d '{"role":"agent","content":"TWOJA ODPOWIEDŹ"}']`
      : message

    try {
      // Bracketed paste (-p) keeps newlines and indentation without submitting; Enter then sends the whole message.
      const buffer = 'visual-review'
      await run('tmux', ['set-buffer', '-b', buffer, '--', text])
      await run('tmux', ['paste-buffer', '-p', '-d', '-b', buffer, '-t', pane])
      await run('tmux', ['send-keys', '-t', pane, 'Enter'])
      if (custom) addChat('human', custom)
      json(res, 200, { ok: true })
    } catch {
      json(res, 502, { error: 'tmux niedostępny lub panel nie istnieje' })
    }
  }

  async function postChat(req: IncomingMessage, res: ServerResponse) {
    // curl from Claude sends no Origin; any browser page from another site is rejected.
    if (!fromLocalPage(req, false)) return json(res, 403, { error: 'origin' })
    const body = await readJson(req)
    if (body.role !== 'agent' || typeof body.content !== 'string') return json(res, 400, { error: 'bad request' })
    const content = body.content.trim().slice(0, MAX_REPLY)
    if (!content) return json(res, 400, { error: 'empty' })
    addChat('agent', content)
    json(res, 200, { ok: true })
  }

  async function upload(req: IncomingMessage, res: ServerResponse) {
    if (!fromLocalPage(req, true)) return json(res, 403, { error: 'origin' })
    if (Number(req.headers['content-length'] ?? 0) > MAX_IMAGE_BYTES)
      return json(res, 413, { error: 'Obraz za duży (max 5 MB).' })
    const bytes = await readBody(req, MAX_IMAGE_BYTES)
    if (!bytes || bytes.length === 0) return json(res, 413, { error: 'Obraz pusty lub za duży (max 5 MB).' })
    const ext = detectExt(bytes)
    if (!ext) return json(res, 415, { error: 'Dozwolone: png, jpeg, webp.' })
    const dir = join(tmpdir(), 'visual-review')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${randomUUID()}.${ext}`)
    await writeFile(path, bytes)
    json(res, 200, { path })
  }

  return {
    name: 'visual-review',
    apply: 'serve',
    configureServer(server) {
      if (env.VITE_VISUAL_REVIEW !== '1') return
      startAgentation(server, env)
      server.middlewares.use(BASE, (req, res, next) => {
        const route = `${req.method} ${(req.url ?? '').split('?')[0]}`
        const handler =
          route === 'POST /notify' ? notify
          : route === 'GET /chat' ? (_: IncomingMessage, r: ServerResponse) => json(r, 200, { messages: chat })
          : route === 'POST /chat' ? postChat
          : route === 'POST /upload' ? upload
          : null
        if (!handler) return next()
        Promise.resolve(handler(req, res)).catch(() => json(res, 500, { error: 'internal' }))
      })
    },
  }
}
