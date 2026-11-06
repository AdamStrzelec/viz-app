import { useEffect } from 'react'
import Annotate from '@reviewjs/annotate'

// Dev-only review layer; "Send feedback" POSTs to /feedback (proxied by Vite to the local receiver).
export default function FeedbackLayer() {
  useEffect(() => {
    Annotate.init({ project: 'viz-app', spa: true, postUrl: '/feedback' })
    return () => Annotate.destroy()
  }, [])
  return null
}
