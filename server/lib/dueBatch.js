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
