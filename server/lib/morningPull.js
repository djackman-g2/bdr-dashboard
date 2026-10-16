// Morning due-pull → draft: the unattended half of the daily loop.
//
// Chain: scripts/groove-due-pull.js (real Groove steps, per flow) → merged CSV
// → dueBatch.startDueBatch() → data/drafts/due-<date>.json. By the time the
// laptop is warm the Due page already holds a draft per due step, grounded in
// the storyline and in what was actually last said (the mirror's touch bodies).
//
// READ-ONLY Groove, by rule. Declan's 2026-08-25 ruling narrowed the old
// "human-invoked terminal tool only" constraint: read-only actions
// (due-list/flows/steps/contact-show — three GETs per flow, nothing against
// the write limits) may run unattended; every WRITE (log-call, log-email,
// advance-step, enroll, remove) stays human-invoked in the terminal. Nothing
// in this module may ever call a write action, and none of it is reachable
// from a `claude -p` pipeline run — this is plain node, no headless Claude.
//
// FAIL LOUD, DRAFT NOTHING. A dead Groove session or a changed API shape stops
// the run with the error recorded and surfaced. It must never fall back to the
// Salesforce mirror's flow_day: that is a stale snapshot, and only Groove knows
// real flow position (the never-infer-groove-steps rule). A wrong step drafts
// the wrong message into a live flow, which is worse than no draft at all.
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, paths } from './config.js'
import { startDueBatch } from './dueBatch.js'

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const PULL_SCRIPT = path.join(serverDir, 'scripts', 'groove-due-pull.js')
const STATE_FILE = path.join(paths.dataDir, 'groove', 'morning-state.json')

// Same local-date basis groove-due-pull.js uses for its filenames. UTC would
// name the file for tomorrow after 7pm Central and the stem would not match.
const today = () => new Date().toLocaleDateString('en-CA')

const state = {
  running: false,
  lastRunDate: null,
  startedAt: null,
  finishedAt: null,
  trigger: null,
  ok: null,
  error: null,
  flows: [],
  rows: 0,
  log: [],
}

function note(line) {
  state.log.push(`${new Date().toISOString().slice(11, 19)}  ${line}`)
  if (state.log.length > 100) state.log.shift()
  console.log(`[morning] ${line}`)
}

async function loadState() {
  try {
    const saved = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
    // Only the cross-restart facts are restored; a run that was in flight when
    // the server died is not resumed, and `running` must never come back true.
    Object.assign(state, { ...saved, running: false })
  } catch {
    /* first run */
  }
}

async function saveState() {
  try {
    await fs.mkdir(path.dirname(STATE_FILE), { recursive: true })
    const tmp = STATE_FILE.replace(/\.json$/, '.tmp.json') // never *.json.tmp — ajv reads those as JS
    await fs.writeFile(tmp, JSON.stringify({ ...state, log: state.log.slice(-40) }, null, 2) + '\n')
    await fs.rename(tmp, STATE_FILE)
  } catch (err) {
    console.error(`[morning] could not persist state: ${err.message}`)
  }
}

// One flow → one CSV, via the same script the CLI runs. Returns its path.
function pullFlow(flowId) {
  return new Promise((resolve, reject) => {
    const args = [PULL_SCRIPT, '--flow', String(flowId)]
    const child = spawn(process.execPath, args, { cwd: serverDir })
    let out = ''
    child.stdout.on('data', (c) => (out += c))
    child.stderr.on('data', (c) => (out += c))
    child.on('error', (err) => reject(new Error(`could not spawn due:pull — ${err.message}`)))
    child.on('close', (code) => {
      const tail = out.trim().split('\n').slice(-6).join(' | ')
      if (code !== 0) return reject(new Error(`due:pull exited ${code} for flow ${flowId} — ${tail}`))
      // The stem is deterministic, but assert the file exists rather than
      // trusting it: a silent rename upstream would otherwise draft nothing
      // and report success.
      const csv = path.join(paths.dataDir, 'groove', `due-${today()}-flow${flowId}.csv`)
      fs.access(csv).then(
        () => resolve(csv),
        () => reject(new Error(`due:pull for flow ${flowId} left no CSV at ${csv} — ${tail}`))
      )
    })
  })
}

// Flows are merged into ONE csv so the batch sees the whole day at once —
// draft.js's per-account batchContext (the anti-duplicate-opener guard) only
// works across contacts inside a single run.
async function mergeCsvs(files) {
  let header = null
  const rows = []
  for (const f of files) {
    const lines = (await fs.readFile(f, 'utf8')).split('\n').filter((l) => l.trim())
    if (!lines.length) continue
    const [h, ...rest] = lines
    if (header && h !== header) {
      throw new Error(`due:pull produced two different CSV headers — Groove's shape changed, re-run \`npm run groove:capture\`.`)
    }
    header ??= h
    rows.push(...rest)
  }
  if (!header) throw new Error('due:pull produced no CSV rows at all')
  return { csv: [header, ...rows].join('\n') + '\n', rows: rows.length }
}

export async function runMorningPull({ trigger = 'manual', force = false } = {}) {
  const cfg = config.groove?.morning ?? {}
  if (!cfg.enabled && !force) return { skipped: 'disabled' }
  if (state.running) return { skipped: 'already running' }

  const date = today()
  if (!force && state.lastRunDate === date) return { skipped: `already ran today (${date})` }

  // A boot at 3am (or a cron misfire) should not pull — earliest_hour keeps
  // unattended Groove traffic inside a normal working window.
  const hour = new Date().getHours()
  const earliest = cfg.earliest_hour ?? 6
  const latest = cfg.latest_hour ?? 20
  if (!force && (hour < earliest || hour >= latest)) {
    return { skipped: `outside ${earliest}:00–${latest}:00 (now ${hour}:00)` }
  }

  const flows = (cfg.flows ?? []).filter(Boolean)
  if (!flows.length) return { skipped: 'no flows configured in config.groove.morning.flows' }

  Object.assign(state, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    trigger,
    ok: null,
    error: null,
    flows,
    rows: 0,
    log: [],
  })
  note(`start (${trigger}) — flows ${flows.join(', ')}`)

  try {
    const files = []
    for (const f of flows) {
      note(`pulling flow ${f}…`)
      files.push(await pullFlow(f)) // sequential: one Groove conversation at a time
    }
    const { csv, rows } = await mergeCsvs(files)
    state.rows = rows
    if (!rows) {
      note('nothing due today — no drafts queued')
      Object.assign(state, { ok: true, lastRunDate: date })
      return { ok: true, rows: 0 }
    }
    note(`${rows} due row(s) → drafting`)
    const started = await startDueBatch(csv, { limit: cfg.limit })
    Object.assign(state, { ok: true, lastRunDate: date })
    note(`batch started (${started.file}) — watch it on the Due page`)
    return { ok: true, rows, batch: started.file }
  } catch (err) {
    // Fail loud, draft nothing. No mirror fallback by design.
    Object.assign(state, { ok: false, error: err.message })
    note(`FAILED — ${err.message}`)
    console.error(`[morning] no drafts were produced. Nothing was written to Groove.`)
    return { ok: false, error: err.message }
  } finally {
    state.running = false
    state.finishedAt = new Date().toISOString()
    await saveState()
  }
}

export function morningStatus() {
  return { ...state, today: today(), config: config.groove?.morning ?? null }
}

export const initMorningPull = loadState
