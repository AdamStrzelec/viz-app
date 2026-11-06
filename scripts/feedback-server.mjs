// Local receiver for @reviewjs/annotate feedback.
// Every POST overwrites feedback/latest.json with the current export.
// Used two ways:
//   - mounted inside the Vite dev server (see vite.config.ts) — `npm run dev` is enough
//   - standalone: `npm run feedback` (port 8787), e.g. for a non-Vite setup
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const MAX_BODY_BYTES = 1024 * 1024

export function createFeedbackHandler({ directory = path.resolve('feedback') } = {}) {
  const file = path.join(directory, 'latest.json')

  return async function handleFeedback(req, res) {
    if (req.method !== 'POST') {
      req.resume()
      return res.writeHead(405, { Allow: 'POST' }).end('Method not allowed')
    }
    if (!/^application\/json(?:\s*;|\s*$)/i.test(req.headers['content-type'] || '')) {
      req.resume()
      return res.writeHead(415).end('Expected application/json')
    }

    let bytes = 0
    const chunks = []
    try {
      for await (const chunk of req) {
        bytes += chunk.length
        if (bytes > MAX_BODY_BYTES) return res.writeHead(413).end('Feedback is too large')
        chunks.push(chunk)
      }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (!payload || payload.kind !== 'annotate-export' || typeof payload.page !== 'string' || !Array.isArray(payload.comments)) {
        return res.writeHead(400).end('Invalid Annotate export')
      }
      await fs.mkdir(directory, { recursive: true })
      // Write to a temp file then rename, so readers never see a half-written file
      const tmp = `${file}.tmp`
      await fs.writeFile(tmp, JSON.stringify({ receivedAt: new Date().toISOString(), ...payload }, null, 2))
      await fs.rename(tmp, file)
      console.log(`[feedback] ${payload.page}: ${payload.comments.length} comment(s) → ${path.relative(process.cwd(), file)}`)
      res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ file: 'latest.json' }))
    } catch (error) {
      if (error instanceof SyntaxError) return res.writeHead(400).end('Invalid JSON')
      console.error('Could not save feedback:', error)
      if (!res.headersSent) res.writeHead(500).end('Could not save feedback')
    }
  }
}

// Standalone mode
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.PORT || 8787)
  const host = process.env.HOST || '127.0.0.1'
  const directory = path.resolve(process.env.FEEDBACK_DIR || 'feedback')
  const handle = createFeedbackHandler({ directory })
  http
    .createServer((req, res) => {
      if (req.url !== '/feedback') {
        req.resume()
        return res.writeHead(404).end('Not found')
      }
      return handle(req, res)
    })
    .listen(port, host, () => console.log(`Feedback receiver: http://${host}:${port}/feedback → ${path.join(directory, 'latest.json')}`))
}
