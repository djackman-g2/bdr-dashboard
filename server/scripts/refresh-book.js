#!/usr/bin/env node
// Hand-invoked book refresh — the replacement for the nightly light cron.
//
//   cd server && npm run refresh:book
//
// The nightly ALL/light sweep was disabled on 2026-09-03 for cost (~$10-12 a
// night across 559 accounts, feeding nothing in the drafting path). It still
// has to run occasionally: it is the only thing that re-syncs the book from
// Salesforce and stamps `open_opps` onto data/index.json, which is what keeps
// the workbench from showing accounts that belong to an AE's live deal
// (integrity rule 13). Monthly is about right, or after the book changes.
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const config = JSON.parse(await readFile(path.join(root, 'config/config.json'), 'utf8'))
const { host, port } = config.server
const BASE = `http://${host}:${port}`

try {
  const health = await fetch(`${BASE}/api/health`)
  if (!health.ok) throw new Error(`HTTP ${health.status}`)
} catch (err) {
  console.error(`server not reachable at ${BASE} (${err.message}) — start it first: cd server && npm start`)
  process.exit(1)
}

const res = await fetch(`${BASE}/api/refresh`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: 'ALL', mode: 'light', origin: 'user' }),
})
const body = await res.json().catch(() => ({}))
if (!res.ok) {
  console.error(`refresh not queued (HTTP ${res.status}): ${body.error ?? 'unknown'}`)
  process.exit(1)
}
console.log(`queued ${body.job?.id} — light refresh of the whole book.`)
console.log(`Runs on Sonnet, up to ${config.refresh.job_timeout_minutes.light} min. Watch it: ${BASE} or tail logs/${body.job?.id}.log`)
