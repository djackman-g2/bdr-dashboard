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
import { handleChat } from './lib/chat.js'
import { handleDraft } from './lib/draft.js'
import { handleStoryline } from './lib/storyline.js'
import { startDueBatch, dueBatchStatus, markDueDraft } from './lib/dueBatch.js'
import { runAiVisibility } from './lib/aiVisibility.js'
import { runCommunity } from './lib/community.js'
import { trackerRouter } from './lib/tracker.js'
import { loadPlays, createPlay, KNOWN_TRIGGERS } from './lib/plays.js'

fs.mkdirSync(paths.logsDir, { recursive: true })
fs.mkdirSync(paths.accountsDir, { recursive: true })

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
      // Sort by start time, not array position — headless runs don't always
      // append their entry at the end of runs[].
      recent_runs: [...(meta.runs ?? [])]
        .sort((a, b) => Date.parse(b.started ?? 0) - Date.parse(a.started ?? 0))
        .slice(0, 10),
    })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

const SECTIONS = ['news', 'hiring', 'g2', 'gong', 'messaging', 'contacts']

app.post('/api/refresh', async (req, res) => {
  const { query, mode, origin, linkedin, section } = req.body ?? {}
  if (typeof query !== 'string' || !query.trim() || query.length > 200) {
    return res.status(400).json({ error: 'query must be a non-empty string (domain, name, SF Id, or "ALL")' })
  }
  if (!['light', 'deep', 'activity', 'section', 'outreach'].includes(mode)) {
    return res.status(400).json({ error: 'mode must be "light", "deep", "activity", "section", or "outreach"' })
  }
  if (query.trim() === 'ALL' && mode !== 'light' && mode !== 'outreach') {
    return res.status(400).json({ error: `${mode} refresh is per-account only — no ${mode} ALL` })
  }
  if (mode === 'outreach' && query.trim() !== 'ALL') {
    return res.status(400).json({ error: 'outreach sync is global — use query "ALL"' })
  }
  if (mode === 'section' && !SECTIONS.includes(section)) {
    return res.status(400).json({ error: `section must be one of: ${SECTIONS.join(', ')}` })
  }
  // origin "user" = a human explicitly asked (dashboard button). Omitted or
  // anything else = "auto" (safe default): the run is spawned with Playwright
  // hard-blocked, so auto-queued deep runs can never touch LinkedIn.
  if (origin !== undefined && origin !== 'user' && origin !== 'auto') {
    return res.status(400).json({ error: 'origin, if given, must be "user" or "auto"' })
  }
  if (linkedin !== undefined && typeof linkedin !== 'boolean') {
    return res.status(400).json({ error: 'linkedin, if given, must be a boolean' })
  }
  try {
    const result = await enqueue({ query: query.trim(), mode, trigger: 'api', origin, linkedin, section })
    if (result.error) return res.status(result.status).json(result)
    res.status(202).json(result)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Outreach tracker (activity logging + contact/account working layer).
// Manual logging only — Groove has no API. Writes data/tracker.json.
app.use('/api/tracker', trackerRouter)

// Plays library — list the frontmattered (matchable) plays, and create a new
// one from the dashboard's "+ new play" modal. A play is just a .md in
// data/plays/: the hook-angle matcher AND the draft engine pick it up on the
// next request, no restart. Creation never overwrites an existing file.
app.get('/api/plays', async (_req, res) => {
  res.json({ plays: await loadPlays(), triggers: KNOWN_TRIGGERS })
})
app.post('/api/plays', async (req, res) => {
  try {
    res.status(201).json(await createPlay(req.body ?? {}))
  } catch (err) {
    res.status(err.code === 'bad-input' ? 400 : 500).json({ error: err.message })
  }
})

// Phase 6 — chat grounded on one account's research JSON. Direct Anthropic
// API call (key from macOS Keychain), no MCPs; streams NDJSON back.
app.post('/api/chat', handleChat)

// Send desk — draft real messaging for one tracker contact (enrollment pack
// or next-step message). Same client as chat; grounded on dossier + plays +
// the Groove mirror's touch history.
app.post('/api/draft', handleDraft)

// Storyline layer — read-only view of an account's narrative file (spine,
// chapters, claims ledger, verification gate). Same loader the draft engine
// uses, so the card and the draft can't disagree. Edits happen by hand.
app.get('/api/storyline/:accountId', handleStoryline)

// Send desk batch — the Due page uploads the Groove due-list CSV as text;
// the server runs scripts/draft-due-csv.js (one next-step draft per row,
// results land in data/drafts/) and the page polls GET for progress.
app.post('/api/draft-due', express.text({ type: '*/*', limit: '2mb' }), async (req, res) => {
  const csv = typeof req.body === 'string' ? req.body : ''
  const header = csv.split('\n', 1)[0] ?? ''
  if (!csv.trim()) return res.status(400).json({ error: 'body must be the CSV text' })
  if (!/name/i.test(header) || !/account/i.test(header)) {
    return res.status(400).json({ error: 'that does not look like the Groove due-list export (need Name + Account columns)' })
  }
  // A due list without steps means every draft is a channel/step guess (a
  // people/manual-import export has this shape) — 2026-07-30 one of those
  // produced a LinkedIn touch for a contact due a Day 7 email. Fail loudly.
  if (!/current step/i.test(header)) {
    return res.status(400).json({ error: 'no "Current Step" column — this looks like a Groove people export, not the Flows → due list. Re-export the due list so each row carries its step.' })
  }
  const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined
  if (req.query.limit && (!Number.isFinite(limit) || limit < 1)) {
    return res.status(400).json({ error: 'limit must be a positive integer' })
  }
  try {
    const result = await startDueBatch(csv, { limit, dryRun: req.query.dryRun === '1' || req.query.dryRun === 'true' })
    res.status(202).json(result)
  } catch (err) {
    if (err.code === 'busy') return res.status(409).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

app.get('/api/draft-due', async (_req, res) => res.json(await dueBatchStatus()))

// One-tap "sent" on a due draft: stamps sentAt in the day file (the Due page
// hides done cards), logs the matching tracker activity, and the saved body
// becomes thread history for future drafts to that person. sent:false undoes
// both. Responds with the full updated day file so the page can re-render.
app.post('/api/draft-due/sent', async (req, res) => {
  const { date, contactId, step, sent } = req.body ?? {}
  if (typeof contactId !== 'string' || !contactId) {
    return res.status(400).json({ error: 'contactId is required' })
  }
  if (step !== undefined && step !== null && typeof step !== 'string') {
    return res.status(400).json({ error: 'step must be a string when given' })
  }
  if (typeof sent !== 'boolean') {
    return res.status(400).json({ error: 'sent must be a boolean' })
  }
  try {
    res.json(await markDueDraft({ date, contactId, step, sent }))
  } catch (err) {
    if (err.code === 'bad-input') return res.status(400).json({ error: err.message })
    if (err.code === 'not-found') return res.status(404).json({ error: err.message })
    res.status(500).json({ error: err.message })
  }
})

// 7G-1 — AI-visibility section update. Server-side completions (same client
// as chat), ajv-validated atomic write; refreshed_at untouched. Also runs
// automatically after every successful deep refresh (see queue.js).
app.post('/api/ai-visibility/:slug', async (req, res) => {
  const { slug } = req.params
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be an account slug' })
  }
  try {
    const section = await runAiVisibility(slug)
    res.json({ slug, ai_visibility: section })
  } catch (err) {
    if (err.code === 'not-found') return res.status(404).json({ error: err.message })
    if (err.code === 'no-key') {
      return res.status(503).json({
        error:
          'Anthropic API key not set. Add it to the macOS Keychain (it is never stored in a file): ' +
          'security add-generic-password -a "$USER" -s bdr-dashboard-anthropic -w',
      })
    }
    if (err.code === 'auth') return res.status(503).json({ error: err.message })
    res.status(502).json({ error: err.message ?? 'ai_visibility run failed' })
  }
})

// Community/UGC section update — Reddit (official API, Keychain creds) + HN
// threads about the account, LLM-classified for relevance, ajv-validated
// atomic write; refreshed_at untouched. Feeds the ugc-narrative play trigger.
app.post('/api/community/:slug', async (req, res) => {
  const { slug } = req.params
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be an account slug' })
  }
  try {
    const section = await runCommunity(slug)
    res.json({ slug, community: section })
  } catch (err) {
    if (err.code === 'not-found') return res.status(404).json({ error: err.message })
    if (err.code === 'no-key') {
      return res.status(503).json({
        error:
          'Anthropic API key not set. Add it to the macOS Keychain (it is never stored in a file): ' +
          'security add-generic-password -a "$USER" -s bdr-dashboard-anthropic -w',
      })
    }
    if (err.code === 'auth') return res.status(503).json({ error: err.message })
    res.status(502).json({ error: err.message ?? 'community run failed' })
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

// ---------- Nightly catch-up ----------
// node-cron only fires if the Mac is awake at 5:30; a slept-through nightly
// was previously just skipped. Checked at boot and hourly: if the last light
// refresh is older than catchup_after_hours (default 26h — just past one
// nightly period, so it only fires when a nightly was actually missed),
// queue one. enqueue() dedupes if an ALL/light job is already queued.
async function catchupCheck() {
  const hours = config.refresh.catchup_after_hours ?? 26
  try {
    const meta = await readMeta()
    // Catch-up recovers MISSED nightlies — it never starts the very first run.
    // A fresh install (null timestamp) would otherwise auto-spawn a pipeline
    // run at boot; the first run must be the nightly cron or a human click.
    if (!meta.last_light_refresh_at) return
    const last = Date.parse(meta.last_light_refresh_at)
    if (Date.now() - last < hours * 3_600_000) return
    const r = await enqueue({ query: 'ALL', mode: 'light', trigger: 'catchup', origin: 'auto' })
    if (r.error) {
      if (r.error !== 'duplicate') console.error(`[catchup] not queued: ${r.error}`)
    } else {
      console.log(`[catchup] last light refresh > ${hours}h ago — queued ${r.job.id}`)
    }
  } catch (err) {
    console.error(`[catchup] check failed: ${err.message}`)
  }
}
setInterval(catchupCheck, 3_600_000)

// ---------- Boot ----------
const { host, port } = config.server
app.listen(port, host, () => {
  console.log(`BDR dashboard server: http://${host}:${port}`)
  recoverAndStart()
  catchupCheck()
})
