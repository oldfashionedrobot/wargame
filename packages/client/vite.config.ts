import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The client calls /api/* relative in every environment. In dev this proxy
// forwards to the server process; in production the server serves this bundle
// itself. Same-origin either way, so there is no CORS and no base URL to
// configure.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
