// Local receiver for @reviewjs/annotate "Send feedback".
// Every POST overwrites feedback/latest.json with the current export.
// Run: npm run feedback (Vite proxies /feedback here in dev).
import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'

const PORT = Number(process.env.PORT || 8787)
const HOST = process.env.HOST || '127.0.0.1'
const DIR = path.resolve(process.env.FEEDBACK_DIR || 'feedback')
const FILE = path.join(DIR, 'latest.json')
const MAX_BODY_BYTES = 1024 * 1024

const server = http.createServer(async (req, res) => {
  if (req.url !== '/feedback') {
    req.resume()
    return res.writeHead(404).end('Not found')
  }
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
    await fs.mkdir(DIR, { recursive: true })
    // Write to a temp file then rename, so readers never see a half-written file
    const tmp = `${FILE}.tmp`
    await fs.writeFile(tmp, JSON.stringify({ receivedAt: new Date().toISOString(), ...payload }, null, 2))
    await fs.rename(tmp, FILE)
    console.log(`[feedback] ${payload.page}: ${payload.comments.length} comment(s) → ${path.relative(process.cwd(), FILE)}`)
    res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }).end(JSON.stringify({ file: 'latest.json' }))
  } catch (error) {
    if (error instanceof SyntaxError) return res.writeHead(400).end('Invalid JSON')
    console.error('Could not save feedback:', error)
    if (!res.headersSent) res.writeHead(500).end('Could not save feedback')
  }
})

server.listen(PORT, HOST, () => console.log(`Feedback receiver: http://${HOST}:${PORT}/feedback → ${FILE}`))
