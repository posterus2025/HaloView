import { defineConfig } from 'vite';
import { resolve } from 'path';
import basicSsl from '@vitejs/plugin-basic-ssl';

export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 3000,
    proxy: {
      // Proxy WebSocket signaling through Vite so everything is HTTPS/WSS on port 3000
      '/signal': {
        target: 'ws://localhost:8080',
        ws: true,
        rewrite: (path) => path.replace(/^\/signal/, ''),
      },
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        capture: resolve(__dirname, 'capture.html'),
      },
    },
  },
});
