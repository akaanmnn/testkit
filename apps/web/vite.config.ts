import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * The API is proxied so the browser only ever talks to one origin in dev. In
 * production the web build is served by any static host pointed at the same
 * origin as the server, which keeps cookies and CORS uninteresting.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@testkit/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
