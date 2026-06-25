import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// Dev-only: fetch token from backend and inject as meta tag so API calls work
const injectDevToken = {
  name: 'inject-vdl-token',
  async transformIndexHtml() {
    try {
      const res = await fetch('http://127.0.0.1:3000/');
      const html = await res.text();
      const m = html.match(/name="vdl-token" content="([^"]+)"/);
      if (m) {
        return [{ tag: 'meta', attrs: { name: 'vdl-token', content: m[1] }, injectTo: 'head' }];
      }
    } catch {}
    return [];
  }
};

export default defineConfig({
  plugins: [react(), tailwindcss(), injectDevToken],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: {
    port: 5173,
    proxy: {
      '/api':      { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/events':   { target: 'http://127.0.0.1:3000', changeOrigin: false },
      '/healthz':  { target: 'http://127.0.0.1:3000', changeOrigin: false }
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true
  }
});
