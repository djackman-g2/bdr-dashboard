// Job queue for headless research runs. Exactly ONE pipeline runs at a time
// (config.refresh.queue_concurrency is documented but the implementation is
// deliberately a single slot — the cap guarantee lives here and only here).
// Queue state persists in data/meta.json so a server restart resumes work.
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { config, paths } from './config.js'
import { readMeta, updateMeta } from './meta.js'
import { runAiVisibility } from './aiVisibility.js'

export const jobEvents = new EventEmitter()

let running = null // { job, child, timer }

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const localDay = (iso) => new Date(iso).toLocaleDateString('en-CA') // YYYY-MM-DD

function emit(type, job, extra = {}) {
  jobEvents.emit('job', { type, job: publicJob(job), ...extra })
}

export function publicJob(job) {
  if (!job) return null
  const { id, query, mode, trigger, origin, status, enqueued_at, started_at, section } = job
  return { id, query, mode, trigger, origin, status, enqueued_at, started_at, ...(section ? { section } : {}) }
}

export async function queueSnapshot() {
  const meta = await readMeta()
  return {
    running: publicJob(running?.job ?? null),
    queue: (meta.job_queue ?? []).filter((j) => j.status === 'queued').map(publicJob),
  }
}

// Deep refreshes consume ZoomInfo credits + tokens; cap per local day.
export async function deepCapStatus() {
  const meta = await readMeta()
  const today = localDay(nowIso())
  const ranToday = (meta.runs ?? []).filter(
    (r) => r.mode === 'deep' && r.started && localDay(r.started) === today
  ).length
  const pending = (meta.job_queue ?? []).filter((j) => j.mode === 'deep').length
  return { cap: config.refresh.deep_refresh_daily_cap, used: ranToday, pending, date: today }
}

// origin: 'user' = a human asked for this specific run (dashboard button /
// explicit API call). Anything else — cron, light-run POST-backs, unlabeled
// requests — is 'auto'. linkedin: true = the human explicitly opted this run
// into LinkedIn verification. Playwright requires deep AND user AND linkedin —
// LinkedIn volume stays a deliberate per-run choice, never a default.
export async function enqueue({ query, mode, trigger, origin, linkedin, section }) {
  const meta = await readMeta()
  const dupe = (meta.job_queue ?? []).find(
    (j) => j.query === query && j.mode === mode && (mode !== 'section' || j.section === section)
  )
  if (dupe) return { error: 'duplicate', status: 409, job: publicJob(dupe) }

  if (mode === 'deep') {
    const cap = await deepCapStatus()
    if (cap.used + cap.pending >= cap.cap) {
      return { error: 'deep_cap_reached', status: 429, cap }
    }
  }

  const job = {
    id: `job-${nowIso().slice(0, 10)}-${crypto.randomBytes(3).toString('hex')}`,
    query,
    mode,
    trigger,
    origin: origin === 'user' ? 'user' : 'auto',
    linkedin: linkedin === true,
    ...(mode === 'section' ? { section } : {}),
    status: 'queued',
    enqueued_at: nowIso(),
  }
  await updateMeta((m) => {
    m.job_queue = [...(m.job_queue ?? []), job]
  })
  emit('queued', job)
  processNext()
  return { job: publicJob(job) }
}

// On boot: anything left 'running' in meta.json is from a crashed server —
// put it back in line, then start the pump.
export async function recoverAndStart() {
  await updateMeta((m) => {
    for (const j of m.job_queue ?? []) if (j.status === 'running') j.status = 'queued'
  })
  processNext()
}

async function processNext() {
  if (running) return
  const meta = await readMeta()
  const job = (meta.job_queue ?? []).find((j) => j.status === 'queued')
  if (!job) return

  job.status = 'running'
  job.started_at = nowIso()
  await updateMeta((m) => {
    const q = (m.job_queue ?? []).find((j) => j.id === job.id)
    if (q) Object.assign(q, { status: 'running', started_at: job.started_at })
  })

  let prompt
  try {
    prompt = await buildPrompt(job)
  } catch (err) {
    await finishJob(job, { ok: false, error: `prompt build failed: ${err.message}` })
    return
  }

  const args = ['-p', prompt]
  // Hard guarantee, independent of prompt wording: Playwright only when a
  // human asked for THIS deep run AND opted it into LinkedIn verification.
  // Light runs and anything auto-queued never get it — LinkedIn automation
  // must not run on a schedule or by default.
  const disallowed = []
  if (!(job.mode === 'deep' && job.origin === 'user' && job.linkedin)) {
    disallowed.push('mcp__playwright__*')
  }
  // Same hard-guarantee idea for ZoomInfo credits: activity runs and every
  // section run EXCEPT contacts are free by contract. Only the contacts
  // section (capped enrich, see config.zoominfo.max_section_contact_enrich)
  // and light/deep pipeline runs may reach ZoomInfo at all.
  if (job.mode === 'activity' || (job.mode === 'section' && job.section !== 'contacts')) {
    disallowed.push('mcp__claude_ai_ZoomInfo__*')
  }
  if (disallowed.length) args.push('--disallowedTools', disallowed.join(','))

  const logFile = path.join(paths.logsDir, `${job.id}.log`)
  const log = fs.createWriteStream(logFile, { flags: 'a' })
  log.write(`--- ${job.id} | ${job.mode} | ${job.query} | trigger=${job.trigger} | ${job.started_at} ---\n`)

  // stdin ignored — otherwise headless claude waits 3s for piped input.
  const child = spawn('claude', args, {
    cwd: paths.root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.pipe(log, { end: false })
  child.stderr.pipe(log, { end: false })

  const timeoutMin =
    config.refresh.job_timeout_minutes?.[job.mode] ?? (job.mode === 'light' ? 90 : 45)
  const timer = setTimeout(() => {
    running && (running.timedOut = true)
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 30_000).unref()
  }, timeoutMin * 60_000)

  running = { job, child, timer, logFile, timedOut: false }
  emit('started', job, { log_file: path.relative(paths.root, logFile) })

  child.on('error', (err) => {
    // spawn failure (e.g. claude not on PATH)
    log.write(`\n[server] spawn error: ${err.message}\n`)
    log.end()
    clearTimeout(timer)
    finishJob(job, { ok: false, error: `spawn error: ${err.message}` })
  })

  child.on('exit', (code, signal) => {
    clearTimeout(timer)
    const timedOut = running?.timedOut
    log.write(`\n[server] exited code=${code} signal=${signal}${timedOut ? ' (timeout)' : ''}\n`)
    log.end()
    const ok = code === 0 && !timedOut
    finishJob(job, {
      ok,
      exit_code: code,
      signal,
      error: ok ? null : timedOut ? `timed out after ${timeoutMin}m` : `exit code ${code}`,
    })
  })
}

async function finishJob(job, result) {
  const finished_at = nowIso()
  const logFile = running?.logFile ?? null
  running = null

  await updateMeta((m) => {
    m.job_queue = (m.job_queue ?? []).filter((j) => j.id !== job.id)
    if (result.ok) {
      if (job.mode === 'light') m.last_light_refresh_at = finished_at
      else m.last_deep_refresh_at = finished_at
    } else {
      // The pipeline logs its own runs; when a job dies before it can, the
      // failure must still be loud in the run log — never a silent no-op.
      m.runs = [
        ...(m.runs ?? []),
        {
          id: job.id,
          started: job.started_at ?? job.enqueued_at,
          finished: finished_at,
          mode: job.mode,
          trigger: `${job.trigger} (server-recorded FAILURE)`,
          accounts_touched: [job.query],
          credits_consuming_calls: [],
          errors: [result.error ?? 'unknown failure'],
          notes: [logFile ? `see ${path.relative(paths.root, logFile)}` : 'no log file'],
        },
      ]
    }
  })

  // 7G-1: every successful deep refresh gets a fresh ai_visibility section —
  // cheap (2-3 small completions via the chat proxy), runs in the job's queue
  // slot before the next job starts. Failure is loud in the run entry but
  // never fails the deep run itself.
  if (result.ok && job.mode === 'deep' && config.ai_visibility?.run_after_deep !== false) {
    const note = await autoAiVisibility(job)
    if (note) {
      await updateMeta((m) => {
        const run = (m.runs ?? []).find((r) => r.id === job.id)
        if (run) run.notes = [...(run.notes ?? []), note]
      })
    }
  }

  emit(result.ok ? 'finished' : 'failed', job, {
    error: result.error ?? null,
    finished_at,
  })
  fireWebhook(result.ok ? 'run_finished' : 'run_failed', {
    job: publicJob(job),
    ok: result.ok,
    error: result.error ?? null,
    finished_at,
    log_file: logFile ? path.relative(paths.root, logFile) : null,
  })
  processNext()
}

// Deep jobs are queued by domain/name/SF Id — resolve to the index slug, then
// run the ai_visibility module for it. Returns a run-entry note (or null when
// the account can't be resolved, e.g. a brand-new domain the pipeline slugged
// differently).
async function autoAiVisibility(job) {
  try {
    const index = JSON.parse(await fsp.readFile(paths.index, 'utf8'))
    const q = job.query.toLowerCase()
    const qSlug = q.replace(/\./g, '-')
    const entry = (index.accounts ?? []).find(
      (a) => a.domain === q || a.slug === qSlug || a.slug === q || (a.name ?? '').toLowerCase() === q
    )
    if (!entry) {
      console.log(`[ai-visibility] no index entry matches "${job.query}" — skipped`)
      return null
    }
    const section = await runAiVisibility(entry.slug)
    return `ai_visibility auto-run after deep (server): ${section.queries.length} queries, summary: ${section.summary ?? 'n/a'}`
  } catch (err) {
    console.error(`[ai-visibility] auto-run failed for ${job.query}: ${err.message}`)
    return `ai_visibility auto-run after deep FAILED (${err.code ?? 'error'}): ${err.message}`
  }
}

async function buildPrompt(job) {
  const file =
    job.query === 'ALL' && job.mode === 'light'
      ? 'refresh-all-light.md'
      : job.mode === 'activity'
        ? 'refresh-activity.md'
        : job.mode === 'section'
          ? 'refresh-section.md'
          : 'refresh-account.md'
  const body = await fsp.readFile(path.join(paths.promptsDir, file), 'utf8')
  return (
    body +
    `\n\n---\nRun parameters (from the local server):\n` +
    `- Job id: ${job.id} (use as the run entry id in data/meta.json)\n` +
    `- Account identifier: ${job.query}\n` +
    `- Run mode: ${job.mode}\n` +
    (job.section ? `- Target section: ${job.section}\n` : '') +
    `- Trigger: ${job.trigger}\n` +
    `- Origin: ${job.origin}\n` +
    `- LinkedIn/Playwright allowed this run: ${job.mode === 'deep' && job.origin === 'user' && job.linkedin ? 'YES (deep, user-requested, LinkedIn opted-in — verification only, respect config.linkedin caps)' : 'NO (tool is hard-blocked; record skipped verification as sources_missing kind=deferred_by_design)'}\n`
  )
}

// Webhook-out hooks (n8n, Phase 4/5). Fire-and-forget; failures only logged.
function fireWebhook(kind, payload) {
  const url = config.server?.webhooks?.[kind]
  if (!url || typeof url !== 'string') return
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ event: kind, ...payload }),
  }).catch((err) => console.error(`[webhook ${kind}] ${err.message}`))
}
