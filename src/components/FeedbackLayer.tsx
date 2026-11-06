import { useEffect } from 'react'
import Annotate from '@reviewjs/annotate'

const POST_URL = '/feedback'
const POLL_MS = 1000
const DEBOUNCE_MS = 800

// Dev-only review layer. Comments are auto-synced to feedback/latest.json
// (via Vite proxy to `npm run feedback`); the "Send feedback" button still works manually.
export default function FeedbackLayer() {
  useEffect(() => {
    Annotate.init({ project: 'viz-app', spa: true, postUrl: POST_URL })

    // The library emits no change event in local mode, so poll the comment list
    let lastSent = ''
    let lastPage = location.pathname
    let debounce: ReturnType<typeof setTimeout> | undefined

    const send = async (snapshot: string) => {
      const config = Annotate.config
      const payload = {
        annotate: Annotate.version,
        kind: 'annotate-export',
        autoSync: true,
        exportedAt: new Date().toISOString(),
        page: `${config?.project ?? 'viz-app'}:${location.pathname}`,
        url: location.href,
        project: config?.project ?? 'viz-app',
        exportedViewport: { vw: innerWidth, vh: innerHeight, dpr: devicePixelRatio },
        comments: JSON.parse(snapshot),
      }
      try {
        const res = await fetch(POST_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        if (res.ok) lastSent = snapshot
      } catch {
        // Receiver not running: retry on next change
      }
    }

    const tick = () => {
      // On route change, sync the new page's comments only once they differ from what was sent
      if (location.pathname !== lastPage) {
        lastPage = location.pathname
        lastSent = JSON.stringify(Annotate.comments())
        return
      }
      const snapshot = JSON.stringify(Annotate.comments())
      if (snapshot === lastSent) return
      clearTimeout(debounce)
      debounce = setTimeout(() => send(snapshot), DEBOUNCE_MS)
    }

    lastSent = JSON.stringify(Annotate.comments())
    const interval = setInterval(tick, POLL_MS)

    return () => {
      clearInterval(interval)
      clearTimeout(debounce)
      Annotate.destroy()
    }
  }, [])
  return null
}
