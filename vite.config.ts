import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'
import { createFeedbackHandler } from './scripts/feedback-server.mjs'

// Serves POST /feedback from the dev server itself, so `npm run dev` also runs the annotation receiver
function feedbackReceiver(): Plugin {
  return {
    name: 'feedback-receiver',
    apply: 'serve',
    configureServer(server) {
      const handle = createFeedbackHandler()
      server.middlewares.use('/feedback', (req, res) => void handle(req, res))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), feedbackReceiver()],
})
