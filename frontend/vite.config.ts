import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Dev only: the browser calls same-origin /api and Vite forwards it to the backend.
  // That way there's no CORS, and an HTTPS dev page never calls a plain-HTTP backend (mixed content).
  const apiTarget = env.API_PROXY_TARGET || 'http://127.0.0.1:8000'
  const proxy = { '/api': { target: apiTarget, changeOrigin: false } }

  return {
    plugins: [react()],
    server: { proxy },
    preview: { proxy },
  }
})
