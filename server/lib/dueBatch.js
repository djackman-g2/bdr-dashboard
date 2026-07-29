// Due-list batch runner — the dashboard's upload path for the Groove
// "due today" CSV. Saves the upload to data/inbox/ and spawns the same
// scripts/draft-due-csv.js the CLI uses (one next-step draft per row),
// tailing its output into an in-memory status the Due page polls. One
// batch at a time; the script itself records failed rows and never blocks.
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { paths } from './config.js'
import { logActivity, undoActivity } from './trackerStore.js'

const serverDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SCRIPT = path.join(serverDir, 'scripts', 'draft-due-csv.js')

const state = {
  running: false,
  startedAt: null,
  finishedAt: null,
  exitCode: null,
  file: null,
  dryRun: false,
  total: null,
  done: 0,
  failed: 0,
  log: [],
}

function ingestLine(line) {
  const l = line.trimEnd()
  if (!l) return
  state.log.push(l)
  if (state.log.length > 200) state.log.shift()
  const m = l.match(/drafting (\d+) message/)
  if (m) state.total = parseInt(m[1], 10)
  if (l.includes('✓')) state.done++
  else if (l.includes('✗')) {
    state.done++
    state.failed++
  }
}

export async function startDueBatch(csvText, { limit, dryRun } = {}) {
  if (state.running) {
    const err = new Error('a due-list batch is already running')
    err.code = 'busy'
    throw err
  }
  const inbox = path.join(paths.dataDir, 'inbox')
  await fs.mkdir(inbox, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const csvPath = path.join(inbox, `due-upload-${stamp}.csv`)
  await fs.writeFile(csvPath, csvText)

  Object.assign(state, {
    running: true,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    file: path.basename(csvPath),
    dryRun: Boolean(dryRun),
    total: null,
    done: 0,
    failed: 0,
    log: [],
  })

  const args = [SCRIPT, csvPath]
  if (Number.isFinite(limit)) args.push('--limit', String(limit))
  if (dryRun) args.push('--dry-run')
  const child = spawn(process.execPath, args, { cwd: serverDir })

  // stdout chunks can split mid-line — only ingest complete lines.
  let buf = ''
  const onData = (chunk) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop()
    for (const l of lines) ingestLine(l)
  }
  child.stdout.on('data', onData)
  child.stderr.on('data', onData)
  child.on('close', (code) => {
    if (buf) ingestLine(buf)
    buf = ''
    state.running = false
    state.exitCode = code
    state.finishedAt = new Date().toISOString()
  })
  child.on('error', (err) => {
    ingestLine(`spawn error: ${err.message}`)
    state.running = false
    state.exitCode = -1
    state.finishedAt = new Date().toISOString()
  })

  return { started: true, file: state.file }
}

// ---------- sent tracking ----------
// Marking a draft "sent" is the Due page's one-tap done: stamp sentAt on the
// entry in data/drafts/due-<date>.json (the page hides done cards), log a
// tracker activity for the channel (counts toward the day's tallies, sets the
// contact's lastTouch — same semantics as the ActivityBar long-press attach),
// and keep the body on disk so the draft engine can feed it back as thread
// history before the Groove mirror catches up. sent:false undoes both the
// stamp and the logged activity. Writes are serialized + atomic like every
// other store in this project.
const CHANNEL_ACTIVITY = { email: 'email', linkedin: 'linkedin', call: 'call' }

let sentChain = Promise.resolve()

export function markDueDraft({ date, contactId, sent }) {
  const run = async () => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
      throw Object.assign(new Error('date must be YYYY-MM-DD'), { code: 'bad-input' })
    }
    const file = path.join(paths.dataDir, 'drafts', `due-${date}.json`)
    let day
    try {
      day = JSON.parse(await fs.readFile(file, 'utf8'))
    } catch {
      throw Object.assign(new Error(`no drafts file for ${date}`), { code: 'not-found' })
    }
    // Same key the batch script dedupes on — contactId, name for legacy rows.
    const entry = (day.drafts ?? []).find((e) => (e.contactId ?? e.name) === contactId)
    if (!entry) throw Object.assign(new Error('no such draft in that day file'), { code: 'not-found' })

    if (sent && !entry.sentAt) {
      entry.sentAt = new Date().toISOString()
      const type = CHANNEL_ACTIVITY[entry.draft?.channel]
      if (type && entry.contactId) {
        const activity = await logActivity({ type, contactId: entry.contactId })
        entry.sentActivityId = activity.id
      }
    } else if (!sent && entry.sentAt) {
      delete entry.sentAt
      if (entry.sentActivityId) {
        await undoActivity(entry.sentActivityId)
        delete entry.sentActivityId
      }
    }
    const tmp = file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(day, null, 2))
    await fs.rename(tmp, file)
    return day
  }
  const result = sentChain.then(run, run)
  sentChain = result.catch(() => {})
  return result
}

export async function dueBatchStatus() {
  let latest = null
  try {
    const dir = path.join(paths.dataDir, 'drafts')
    const files = (await fs.readdir(dir))
      .filter((f) => /^due-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
    if (files[0]) latest = { date: files[0].slice(4, 14), path: `/data/drafts/${files[0]}` }
  } catch {
    /* no drafts yet */
  }
  return { ...state, log: state.log.slice(-30), lastLine: state.log[state.log.length - 1] ?? null, latest }
}
