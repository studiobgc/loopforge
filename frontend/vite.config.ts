import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports - single source of truth for frontend config
const FRONTEND_PORT = 3333
const BACKEND_PORT = 8888

export default defineConfig({
  plugins: [react()],
  server: {
    port: FRONTEND_PORT,
    host: true,
    allowedHosts: ['loopforge.local', 'localhost', '127.0.0.1'],
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true
      },
      '/ws': {
        target: `ws://localhost:${BACKEND_PORT}`,
        ws: true
      },
      '/files': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true
      }
    }
  }
})
