#!/usr/bin/env node
// Where the money went — one view over both halves of the bill.
//
//   cd server && npm run spend            # this month
//   cd server && npm run spend 2026-08    # a specific month
//
// Two independent sources, because the two halves bill differently:
//   * Headless pipeline runs (deep/brief/light/outreach/...) self-report
//     total_cost_usd in their stream-json result event; the server stamps it
//     onto the run entry in data/meta.json (runs before 2026-09-04 have none).
//   * Drafts bill through the LiteLLM proxy and are priced here from the token
//     usage recorded per entry in data/drafts/due-<date>.json.
//
// Neither covers interactive Claude Code / Cowork sessions — for the real
// total including those, ask the AI Spend Dashboard.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const month = process.argv[2] ?? new Date().toISOString().slice(0, 7)

const PRICES = {
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
}
const config = JSON.parse(await fs.readFile(path.join(root, 'config/config.json'), 'utf8'))
const draftModel = config.draft?.model ?? config.chat?.model ?? 'claude-sonnet-5'
const dp = PRICES[draftModel] ?? PRICES['claude-sonnet-5']
const usd = (n) => '$' + n.toFixed(2)

// ---------- pipeline runs ----------
const meta = JSON.parse(await fs.readFile(path.join(root, 'data/meta.json'), 'utf8'))
const runs = (meta.runs ?? []).filter((r) => (r.started ?? '').startsWith(month))
const byMode = new Map()
let unpriced = 0
for (const r of runs) {
  const m = byMode.get(r.mode) ?? { n: 0, cost: 0, priced: 0, subagents: 0 }
  m.n++
  if (typeof r.cost_usd === 'number') {
    m.cost += r.cost_usd
    m.priced++
    m.subagents += r.subagents_spawned ?? 0
  } else unpriced++
  byMode.set(r.mode, m)
}

console.log(`\n=== ${month} — pipeline runs (headless claude -p) ===`)
if (!runs.length) console.log('  none')
else {
  console.log('  mode      runs  priced      cost   avg/run  subagents')
  let tot = 0
  for (const [mode, m] of [...byMode].sort((a, b) => b[1].cost - a[1].cost)) {
    tot += m.cost
    const avg = m.priced ? usd(m.cost / m.priced) : '—'
    console.log(
      `  ${mode.padEnd(9)} ${String(m.n).padStart(4)} ${String(m.priced).padStart(6)} ${usd(m.cost).padStart(9)} ${avg.padStart(9)} ${String(m.subagents).padStart(10)}`
    )
  }
  console.log(`  ${'TOTAL'.padEnd(9)} ${String(runs.length).padStart(4)} ${''.padStart(6)} ${usd(tot).padStart(9)}`)
  if (unpriced) console.log(`  (${unpriced} run(s) carry no cost — they predate cost capture on 2026-09-04, or were killed before emitting a result)`)
}

// ---------- drafts ----------
const draftsDir = path.join(root, 'data/drafts')
let files = []
try {
  files = (await fs.readdir(draftsDir)).filter((f) => f.startsWith(`due-${month}`) && f.endsWith('.json'))
} catch {
  /* no drafts dir */
}
console.log(`\n=== ${month} — drafts (LiteLLM proxy, ${draftModel}) ===`)
let dTot = 0
let dCount = 0
let dNoUsage = 0
const days = []
for (const f of files.sort()) {
  const day = JSON.parse(await fs.readFile(path.join(draftsDir, f), 'utf8'))
  const t = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  let priced = 0
  for (const e of day.drafts ?? []) {
    if (!e.usage) { dNoUsage++; continue }
    priced++
    for (const k of Object.keys(t)) t[k] += e.usage[k] ?? 0
  }
  const cost =
    (t.input_tokens * dp.input + t.output_tokens * dp.output +
      t.cache_creation_input_tokens * dp.cacheWrite + t.cache_read_input_tokens * dp.cacheRead) / 1e6
  dTot += cost
  dCount += priced
  days.push({ date: f.slice(4, 14), n: (day.drafts ?? []).length, priced, cost })
}
if (!days.length) console.log('  none')
else {
  console.log('  date         drafts  priced      cost   per draft')
  for (const d of days) {
    console.log(
      `  ${d.date}   ${String(d.n).padStart(6)} ${String(d.priced).padStart(6)} ${usd(d.cost).padStart(9)} ${(d.priced ? usd(d.cost / d.priced) : '—').padStart(11)}`
    )
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${''.padStart(6)} ${String(dCount).padStart(6)} ${usd(dTot).padStart(9)}`)
  if (dNoUsage) console.log(`  (${dNoUsage} draft(s) carry no usage — before per-draft usage logging on 2026-09-03)`)
}

const pipeTot = [...byMode.values()].reduce((a, m) => a + m.cost, 0)
console.log(`\n=== ${month} measured total: ${usd(pipeTot + dTot)} ===`)
console.log('(pipeline + drafts only — interactive Claude Code / Cowork sessions are not in here;')
console.log(' those were 58% of the August bill. Budget is $100/mo.)\n')
