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
import { runCommunity } from './community.js'
import { buildStoryline } from './storylineBuilder.js'

export const jobEvents = new EventEmitter()

// Tool surface for every headless spawn. Without this, `claude -p` advertises
// EVERY MCP server on the account (Jira, Notion, Slack, Gmail, Calendar,
// HubSpot, ...) to the model on every single turn — confirmed 2026-09-09 via
// a stuck brief-mode job log: 205 available tools, average ~55K prompt
// tokens/request per the spend dashboard, none of it needed by any refresh
// prompt. .claude/settings.json's permissions.allow only governs auto-approval
// (no prompt-blocking on match) — it does NOT restrict which tools are
// visible, so it alone never enforced the "exactly these tools" comment at
// the top of that file. This list is the actual enforcement; per-job
// disallowedTools below still narrows ZoomInfo/Playwright/Task further.
const BASE_ALLOWED_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'WebSearch', 'WebFetch',
  'mcp__claude_ai_Salesforce_Native_MCP_Reads_PROD__getUserInfo',
  'mcp__claude_ai_Salesforce_Native_MCP_Reads_PROD__soqlQuery',
  'mcp__claude_ai_Salesforce_Native_MCP_Reads_PROD__getObjectSchema',
  'mcp__claude_ai_Salesforce_Native_MCP_Reads_PROD__getRelatedRecords',
  'mcp__claude_ai_Salesforce_Native_MCP_Reads_PROD__find',
  'mcp__claude_ai_G2_MCP_Server__list_my_products',
  'mcp__claude_ai_G2_MCP_Server__show_product',
  'mcp__claude_ai_G2_MCP_Server__show_vendor',
  'mcp__claude_ai_G2_MCP_Server__browse_buyer_intent',
  'mcp__claude_ai_G2_MCP_Server__browse_product_buyer_intent',
  'mcp__claude_ai_Gong_MCP_PROD__ask_account',
  'mcp__claude_ai_Gong_MCP_PROD__ask_deal',
  'mcp__claude_ai_Gong_MCP_PROD__generate_brief',
  // Narrowed further per-job below (disallowedTools) — allowed broadly here
  // so the eligible cases (deep contacts/firmographics; deep+user+linkedin)
  // still get them.
  'mcp__claude_ai_ZoomInfo__*',
  'mcp__playwright__*',
]

let running = null // { job, child, timer, heartbeat }

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
  // Pin the model explicitly — never inherit whatever the ambient/global
  // `claude` default happens to be (it can drift, e.g. to Fable, via an
  // unrelated `/model` change). Deep is the only mode that gets Opus; every
  // other mode (light/activity/section/outreach) runs on Sonnet. Fable is
  // never selected here under any mode.
  args.push('--model', job.mode === 'deep' ? 'opus' : 'sonnet')
  // Cap the visible tool surface to what the refresh prompts actually use —
  // see BASE_ALLOWED_TOOLS above. Task is added only for deep, which is the
  // only prompt (refresh-account.md Step 2b) that fans out subagents.
  const allowed = [...BASE_ALLOWED_TOOLS]
  if (job.mode === 'deep') allowed.push('Task')
  args.push('--allowedTools', allowed.join(','))
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
  if (
    job.mode === 'activity' ||
    job.mode === 'outreach' ||
    job.mode === 'brief' ||
    (job.mode === 'section' && job.section !== 'contacts')
  ) {
    disallowed.push('mcp__claude_ai_ZoomInfo__*')
  }
  // No mode but deep uses subagents (brief's whole cost premise is running
  // every step sequentially — see refresh-brief.md Step 0).
  if (job.mode !== 'deep') disallowed.push('Task')
  if (disallowed.length) args.push('--disallowedTools', disallowed.join(','))
  // Stream NDJSON events instead of one buffered blob (2026-09-04). Two
  // reasons, both learned the hard way: a run killed by the timeout used to
  // leave a COMPLETELY EMPTY log (headless claude buffers until it finishes),
  // so there was no way to tell a slow run from a hung one; and the final
  // {"type":"result"} event carries total_cost_usd, which is the only place a
  // headless run's real price is reported. Nothing parses stdout for control
  // flow — it is piped to the log and scanned for that one event — so this is
  // purely additive.
  args.push('--output-format', 'stream-json', '--verbose')

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

  // Keep a rolling tail of stdout so the final result event can be read on
  // exit without holding the whole (very large) event stream in memory.
  let tail = ''
  child.stdout.on('data', (chunk) => {
    tail = (tail + chunk.toString()).slice(-131072)
  })

  // Hold off idle sleep while a run is in flight — a run suspended mid-sleep
  // blows past its wall-clock timeout on wake. (A closed lid still sleeps
  // regardless — caffeinate -is only blocks IDLE sleep, and on battery power
  // there is no software override for a closed lid; caffeinate exits on its
  // own when the watched pid does.) Confirmed via `pmset -g log` 2026-09-09:
  // a 4-brief overnight batch each "timed out after 40m" but actually ran
  // 62-110 minutes wall-clock — the machine was in real 'Sleep' state (not
  // just dark wake) for ~55min and ~73min stretches mid-run, on battery, so
  // Node's setTimeout simply paused and resumed rather than firing late. The
  // heartbeat below can't PREVENT this (nothing in software can, on battery,
  // lid closed, no external display) but it makes the gap self-diagnosing —
  // "timed out after Nm" alone is misleading (Nm is awake-time, not
  // wall-clock) and cost a long pmset-log forensic dig to explain once already.
  spawn('caffeinate', ['-is', '-w', String(child.pid)], { stdio: 'ignore' }).on('error', () => {})

  const HEARTBEAT_MS = 30_000
  let lastTick = Date.now()
  let sleepGapMs = 0
  const heartbeat = setInterval(() => {
    const now = Date.now()
    const gap = now - lastTick
    // Anything past ~3x the interval means the event loop itself was
    // suspended (system sleep), not just a busy tick — a live process never
    // drifts a plain setInterval by minutes.
    if (gap > HEARTBEAT_MS * 3) sleepGapMs += gap - HEARTBEAT_MS
    lastTick = now
  }, HEARTBEAT_MS)

  const timeoutMin =
    config.refresh.job_timeout_minutes?.[job.mode] ?? (job.mode === 'light' ? 90 : 45)
  const timer = setTimeout(() => {
    running && (running.timedOut = true)
    child.kill('SIGTERM')
    setTimeout(() => child.kill('SIGKILL'), 30_000).unref()
  }, timeoutMin * 60_000)

  running = { job, child, timer, heartbeat, logFile, timedOut: false }
  emit('started', job, { log_file: path.relative(paths.root, logFile) })

  child.on('error', (err) => {
    // spawn failure (e.g. claude not on PATH)
    log.write(`\n[server] spawn error: ${err.message}\n`)
    log.end()
    clearTimeout(timer)
    clearInterval(heartbeat)
    finishJob(job, { ok: false, error: `spawn error: ${err.message}` })
  })

  child.on('exit', (code, signal) => {
    clearTimeout(timer)
    clearInterval(heartbeat)
    const timedOut = running?.timedOut
    const cost = parseRunCost(tail)
    const sleepMin = sleepGapMs > 0 ? Math.round(sleepGapMs / 60_000) : 0
    log.write(
      `\n[server] exited code=${code} signal=${signal}${timedOut ? ' (timeout)' : ''}` +
        (cost?.cost_usd != null ? ` cost=$${cost.cost_usd.toFixed(4)}` : '') +
        (sleepMin > 0 ? ` (detected ~${sleepMin}min system sleep during run)` : '') +
        '\n'
    )
    log.end()
    const ok = code === 0 && !timedOut
    let error = ok ? null : timedOut ? `timed out after ${timeoutMin}m` : `exit code ${code}`
    if (error && sleepMin > 0) {
      // Don't let "timed out after Nm" read as a hung/broken pipeline when
      // it's actually a closed lid — Nm is awake-time only, and the real
      // wall-clock overrun is sleep, not the pipeline stalling.
      error += ` (~${sleepMin}min of that was system sleep, not run time — check for a closed lid, not a pipeline hang)`
    }
    finishJob(job, { ok, exit_code: code, signal, cost, error })
  })
}

async function finishJob(job, result) {
  const finished_at = nowIso()
  const logFile = running?.logFile ?? null
  running = null

  // A pipeline can abort loudly ("FATAL: ..." in its own run entry) yet still
  // exit 0. These timestamps gate the hourly catch-up, so a FATAL run must not
  // advance them — otherwise a failed nightly buys itself a
  // catchup_after_hours snooze. Non-FATAL errors (per-account hiccups) still
  // count as success: treating them as failures would re-run a ~90-minute
  // pipeline every hour over one flaky fetch.
  let fatal = null
  await updateMeta((m) => {
    // Stamp the measured price onto whatever run entry exists for this job —
    // the pipeline writes its own entry, so this annotates rather than
    // replaces. subagents_spawned is here because a fan-out is the single
    // biggest cost multiplier and brief mode forbids it: a non-zero count on
    // a brief run means the prompt's no-subagents rule was ignored.
    if (result.cost) {
      const e = (m.runs ?? []).find((r) => r.id === job.id)
      if (e) {
        e.cost_usd = result.cost.cost_usd
        e.run_duration_ms = result.cost.duration_ms
        e.subagents_spawned = result.cost.subagents_spawned
        e.model_usage = result.cost.models
      }
    }
    m.job_queue = (m.job_queue ?? []).filter((j) => j.id !== job.id)
    const entry = (m.runs ?? []).find((r) => r.id === job.id)
    fatal = (entry?.errors ?? []).find((e) => typeof e === 'string' && e.startsWith('FATAL')) ?? null
    // A FATAL run still exits 0, so it never reaches the !result.ok branch —
    // both failure shapes have to bump the same counter, or the hourly
    // catch-up circuit breaker in index.js never trips on the exact failure
    // mode that caused the 8-runs-in-a-row incident on 2026-08-22.
    if (job.mode === 'light' && (!result.ok || fatal)) {
      m.consecutive_light_failures = (m.consecutive_light_failures ?? 0) + 1
    }
    if (result.ok && !fatal) {
      if (job.mode === 'light') {
        m.last_light_refresh_at = finished_at
        m.consecutive_light_failures = 0
      } else if (job.mode === 'deep') m.last_deep_refresh_at = finished_at
      else if (job.mode === 'brief') m.last_brief_refresh_at = finished_at
      else if (job.mode === 'outreach') m.last_outreach_sync_at = finished_at
    } else if (!result.ok) {
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

  const ok = result.ok && !fatal
  const error = result.error ?? fatal

  // 7G-1: every successful deep refresh gets a fresh ai_visibility section —
  // cheap (2-3 small completions via the chat proxy), runs in the job's queue
  // slot before the next job starts. Failure is loud in the run entry but
  // never fails the deep run itself.
  const aivAfter =
    (job.mode === 'deep' && config.ai_visibility?.run_after_deep !== false) ||
    (job.mode === 'brief' && config.ai_visibility?.run_after_brief !== false)
  if (ok && aivAfter) {
    const note = await autoAiVisibility(job)
    if (note) {
      await updateMeta((m) => {
        const run = (m.runs ?? []).find((r) => r.id === job.id)
        if (run) run.notes = [...(run.notes ?? []), note]
      })
    }
  }

  // Community/UGC section rides the same hook when enabled (config default
  // off — flip community.run_after_deep once Reddit creds are in the Keychain).
  if (ok && job.mode === 'deep' && config.community?.run_after_deep === true) {
    const note = await autoSection(job, 'community', async (slug) => {
      const section = await runCommunity(slug)
      return `community auto-run after deep (server): ${section.threads.length} threads, summary: ${section.summary ?? 'n/a'}`
    })
    if (note) {
      await updateMeta((m) => {
        const run = (m.runs ?? []).find((r) => r.id === job.id)
        if (run) run.notes = [...(run.notes ?? []), note]
      })
    }
  }

  // Storyline layer rides the same hook (2026-09-01): one direct LLM call,
  // skips instantly when a storyline already exists or the account has too
  // few icp_contacts to mesh — see server/lib/storylineBuilder.js.
  //
  // Fires after BRIEF too as of 2026-09-08. Deep is hand-invoked and capped at
  // 2/day, so gating the storyline on it meant ~everything researched under the
  // spend cut got a dossier and no narrative layer — and the storyline is the
  // part that makes five colleagues at one account read as one story instead of
  // five pitches. One Sonnet call (~$0.10) on top of a ~$0.40 brief.
  if (
    ok &&
    ((job.mode === 'deep' && config.storyline?.auto_build_after_deep !== false) ||
      (job.mode === 'brief' && config.storyline?.auto_build_after_brief !== false))
  ) {
    const note = await autoSection(job, 'storyline', async (slug) => {
      const result = await buildStoryline(slug)
      if (result.skipped) return `storyline auto-build skipped for ${slug}: ${result.skipped}`
      return `storyline auto-built after ${job.mode} (server): ${result.cast_count} contacts — "${result.spine.slice(0, 100)}..."`
    })
    if (note) {
      await updateMeta((m) => {
        const run = (m.runs ?? []).find((r) => r.id === job.id)
        if (run) run.notes = [...(run.notes ?? []), note]
      })
    }
  }

  // Groove mirror: the nightly light run means the book is fresh — follow it
  // with an outreach sync so the tracker's flow positions are fresh too.
  if (ok && job.mode === 'light' && job.query === 'ALL' && config.outreach?.sync_after_light !== false) {
    enqueue({ query: 'ALL', mode: 'outreach', trigger: 'after-light', origin: 'auto' }).then((r) => {
      if (r.error && r.error !== 'duplicate') console.error(`[outreach] auto-sync not queued: ${r.error}`)
    })
  }

  emit(ok ? 'finished' : 'failed', job, {
    error: error ?? null,
    finished_at,
  })
  fireWebhook(ok ? 'run_finished' : 'run_failed', {
    job: publicJob(job),
    ok,
    error: error ?? null,
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
    // Name the mode that actually triggered it — this hook fires after brief
    // runs too now, and a note reading "after deep" on a brief run's entry
    // makes the run log lie about what spent what.
    return `ai_visibility auto-run after ${job.mode} (server): ${section.queries.length} queries, summary: ${section.summary ?? 'n/a'}`
  } catch (err) {
    console.error(`[ai-visibility] auto-run failed for ${job.query}: ${err.message}`)
    return `ai_visibility auto-run after ${job.mode} FAILED (${err.code ?? 'error'}): ${err.message}`
  }
}

// Generic after-deep section hook: resolve the job's query to an index slug
// (same rules as autoAiVisibility) and run fn(slug) → run-entry note.
async function autoSection(job, label, fn) {
  try {
    const index = JSON.parse(await fsp.readFile(paths.index, 'utf8'))
    const q = job.query.toLowerCase()
    const qSlug = q.replace(/\./g, '-')
    const entry = (index.accounts ?? []).find(
      (a) => a.domain === q || a.slug === qSlug || a.slug === q || (a.name ?? '').toLowerCase() === q
    )
    if (!entry) {
      console.log(`[${label}] no index entry matches "${job.query}" — skipped`)
      return null
    }
    return await fn(entry.slug)
  } catch (err) {
    console.error(`[${label}] auto-run failed for ${job.query}: ${err.message}`)
    return `${label} auto-run after deep FAILED (${err.code ?? 'error'}): ${err.message}`
  }
}

// Pull the price of a run out of its stream-json tail. The last
// {"type":"result"} event carries total_cost_usd plus a per-model usage
// breakdown; a run that was killed never emits one, which is itself the
// signal that the cost is unknown rather than zero.
function parseRunCost(tail) {
  if (!tail) return null
  const lines = tail.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (!line.startsWith('{') || !line.includes('"type":"result"')) continue
    try {
      const evt = JSON.parse(line)
      if (evt.type !== 'result') continue
      return {
        cost_usd: typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : null,
        duration_ms: evt.duration_ms ?? null,
        num_turns: evt.num_turns ?? null,
        models: Object.fromEntries(
          Object.entries(evt.modelUsage ?? {}).map(([m, u]) => [
            m,
            { cost_usd: u.costUSD ?? null, in: u.inputTokens ?? 0, out: u.outputTokens ?? 0 },
          ])
        ),
        subagents_spawned: evt.subagent_stats?.spawned ?? null,
      }
    } catch {
      /* truncated line — keep scanning backwards */
    }
  }
  return null
}

async function buildPrompt(job) {
  const file =
    job.query === 'ALL' && job.mode === 'light'
      ? 'refresh-all-light.md'
      : job.mode === 'outreach'
        ? 'refresh-outreach.md'
        : job.mode === 'activity'
          ? 'refresh-activity.md'
          : job.mode === 'section'
            ? 'refresh-section.md'
            : job.mode === 'brief'
              ? 'refresh-brief.md'
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
