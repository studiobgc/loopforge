import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports - single source of truth for frontend config
// Development URL: http://loopforge.local:3001/
const FRONTEND_PORT = 3001
const BACKEND_PORT = 8000

export default defineConfig({
  plugins: [react()],
  server: {
    port: FRONTEND_PORT,
    host: true,
    // Allow local + Tailscale access (100.x.x.x IPs and *.ts.net domains)
    allowedHosts: true,  // Allow all hosts for Tailscale compatibility
    proxy: {
      '/api': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true,
        ws: true  // Enable WebSocket proxying for /api/ws/* endpoints
      },
      '/files': {
        target: `http://localhost:${BACKEND_PORT}`,
        changeOrigin: true
      }
    }
  }
})
