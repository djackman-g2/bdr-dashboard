import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'
import fs from 'node:fs'

// Serves ../data at /data/* during dev, mirroring the URL shape the Phase 3
// Express server will expose, so the SPA needs no changes when it arrives.
function serveDataDir() {
  const dataDir = path.resolve(__dirname, '../data')
  return {
    name: 'serve-data-dir',
    configureServer(server) {
      server.middlewares.use('/data', (req, res, next) => {
        const urlPath = decodeURIComponent(req.url.split('?')[0])
        const filePath = path.resolve(path.join(dataDir, urlPath))
        if (!filePath.startsWith(dataDir + path.sep) && filePath !== dataDir) return next()
        fs.readFile(filePath, (err, buf) => {
          if (err) {
            res.statusCode = 404
            res.end(JSON.stringify({ error: 'not found' }))
            return
          }
          res.setHeader('Content-Type', 'application/json')
          res.setHeader('Cache-Control', 'no-store')
          res.end(buf)
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), serveDataDir()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Refresh API + SSE come from the Phase 3 Express server when it's up.
    proxy: {
      '/api': { target: 'http://127.0.0.1:4680', changeOrigin: false },
    },
  },
})
