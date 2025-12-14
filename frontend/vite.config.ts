import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3333,
    host: true,
    allowedHosts: ['loopforge.local', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: 'http://localhost:8888',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:8888',
        ws: true
      },
      '/files': {
        target: 'http://localhost:8888',
        changeOrigin: true
      }
    }
  }
})
