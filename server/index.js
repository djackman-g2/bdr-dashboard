// BDR Account Research Dashboard — local server (Phase 3).
// Serves the built dashboard + data JSON, exposes the refresh API, pushes
// data-change events over SSE, and runs the nightly light refresh. This layer
// never calls MCPs — all research happens in the headless Claude it spawns.
import express from 'express'
import chokidar from 'chokidar'
import cron from 'node-cron'
import fs from 'node:fs'
import path from 'node:path'
import { config, paths } from './lib/config.js'
import { readMeta } from './lib/meta.js'
import {
  enqueue,
  recoverAndStart,
  queueSnapshot,
  deepCapStatus,
  jobEvents,
} from './lib/queue.js'

fs.mkdirSync(paths.logsDir, { recursive: true })

const app = express()
app.use('/api', express.json())

// ---------- SSE ----------
const sseClients = new Set()

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of sseClients) res.write(frame)
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  res.write(`event: hello\ndata: {}\n\n`)
  sseClients.add(res)
  req.on('close', () => sseClients.delete(res))
})

setInterval(() => {
  for (const res of sseClients) res.write(': ping\n\n')
}, 25_000).unref()

jobEvents.on('job', (evt) => broadcast('job', evt))

// Watch data/ and push changes; awaitWriteFinish avoids half-written JSON.
chokidar
  .watch(paths.dataDir, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 100 },
  })
  .on('all', (event, filePath) => {
    if (!filePath.endsWith('.json')) return
    broadcast('data', { event, path: path.relative(paths.root, filePath) })
  })

// ---------- API ----------
app.get('/api/health', (_req, res) => res.json({ ok: true }))

app.get('/api/status', async (_req, res) => {
  try {
    const [meta, snapshot, cap] = [await readMeta(), await queueSnapshot(), await deepCapStatus()]
    res.json({
      ...snapshot,
      deep_cap: cap,
      last_light_refresh_at: meta.last_light_refresh_at,
      last_deep_refresh_at: meta.last_deep_refresh_at,
      nightly_light_cron: config.refresh.nightly_light_cron,
      recent_runs: (meta.runs ?? []).slice(-10).reverse(),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

app.post('/api/refresh', async (req, res) => {
  const { query, mode, origin } = req.body ?? {}
  if (typeof query !== 'string' || !query.trim() || query.length > 200) {
    return res.status(400).json({ error: 'query must be a non-empty string (domain, name, SF Id, or "ALL")' })
  }
  if (mode !== 'light' && mode !== 'deep') {
    return res.status(400).json({ error: 'mode must be "light" or "deep"' })
  }
  if (query.trim() === 'ALL' && mode === 'deep') {
    return res.status(400).json({ error: 'deep refresh is per-account only — no deep ALL' })
  }
  // origin "user" = a human explicitly asked (dashboard button). Omitted or
  // anything else = "auto" (safe default): the run is spawned with Playwright
  // hard-blocked, so auto-queued deep runs can never touch LinkedIn.
  if (origin !== undefined && origin !== 'user' && origin !== 'auto') {
    return res.status(400).json({ error: 'origin, if given, must be "user" or "auto"' })
  }
  try {
    const result = await enqueue({ query: query.trim(), mode, trigger: 'api', origin })
    if (result.error) return res.status(result.status).json(result)
    res.status(202).json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ---------- Static ----------
// Data JSON — same URL shape the Vite dev shim mirrors. Never cached.
app.use(
  '/data',
  express.static(paths.dataDir, {
    index: false,
    etag: false,
    lastModified: false,
    setHeaders: (res) => res.setHeader('Cache-Control', 'no-store'),
  })
)

// Built dashboard, with SPA fallback.
app.use(express.static(paths.dashboardDist))
app.get(/^\/(?!api\/|data\/).*/, (_req, res) => {
  const indexHtml = path.join(paths.dashboardDist, 'index.html')
  if (fs.existsSync(indexHtml)) return res.sendFile(indexHtml)
  res
    .status(503)
    .type('text/plain')
    .send('Dashboard not built yet — run: cd dashboard && npm run build')
})

// ---------- Cron ----------
const cronExpr = config.refresh.nightly_light_cron
if (cron.validate(cronExpr)) {
  cron.schedule(cronExpr, () => {
    enqueue({ query: 'ALL', mode: 'light', trigger: 'cron-nightly', origin: 'auto' }).then((r) => {
      if (r.error) console.error(`[cron] nightly light refresh not queued: ${r.error}`)
      else console.log(`[cron] nightly light refresh queued as ${r.job.id}`)
    })
  })
  console.log(`[cron] nightly light refresh scheduled: "${cronExpr}"`)
} else {
  console.error(`[cron] INVALID expression in config: "${cronExpr}" — nightly refresh DISABLED`)
}

// ---------- Boot ----------
const { host, port } = config.server
app.listen(port, host, () => {
  console.log(`BDR dashboard server: http://${host}:${port}`)
  recoverAndStart()
})
