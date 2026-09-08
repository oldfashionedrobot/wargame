// vitest/config is vite's defineConfig plus the typed `test` key -- one config
// for both tools, which is the reason the client runs Vitest at all.
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

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
  test: {
    environment: 'happy-dom',
    // Unmounts what each test rendered. See the file for why this is not
    // automatic here.
    setupFiles: ['./src/test-setup.ts'],
  },
});
