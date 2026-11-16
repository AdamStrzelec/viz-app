import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { visualReview } from './vite.visual-review.ts'
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
export default defineConfig(({ mode }) => {
  // '' prefix: also expose non-VITE_ vars (AGENTATION_TMUX_PANE) to the dev-only server plugin, never to the client
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }
  return {
    plugins: [react(), tailwindcss(), feedbackReceiver(), visualReview(env)],
  }
})
