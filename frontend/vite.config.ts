import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    allowedHosts: true,
    port: 5173,
    proxy: {
      '/cached': {
        target: 'http://localhost:3005',
        changeOrigin: true
      },
      '/api': {
        target: 'http://localhost:3005',
        changeOrigin: true
      },
      '/socket.io': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        ws: true
      }
    }
  },
  build: {
    outDir: path.resolve(__dirname, '../backend/app/public/dist'),
    emptyOutDir: true
  }
});
