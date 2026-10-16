#!/usr/bin/env node
// Price a day of drafts from the token usage recorded in data/drafts/due-<date>.json.
//
//   node server/scripts/draft-cost.js            # today
//   node server/scripts/draft-cost.js 2026-09-04
//   node server/scripts/draft-cost.js --all      # every day file that has usage
//
// Entries written before 2026-09-03 carry no `usage` and are reported as
// unpriced rather than guessed at.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const draftsDir = path.join(root, 'data/drafts')

// Anthropic list prices, USD per million tokens (verified 2026-09-03).
// Cache write is the 5-minute TTL at 1.25x input; cache read is 0.1x input.
// These calls actually bill through G2's LiteLLM proxy, so treat the total as
// a close estimate of the invoice rather than the invoice itself.
const PRICES = {
  'claude-sonnet-5': { input: 2.0, output: 10.0, cacheWrite: 2.5, cacheRead: 0.2 },
  'claude-opus-5': { input: 5.0, output: 25.0, cacheWrite: 6.25, cacheRead: 0.5 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 },
}
const config = JSON.parse(await fs.readFile(path.join(root, 'config/config.json'), 'utf8'))
const MODEL = config.draft?.model ?? config.chat?.model ?? 'claude-sonnet-5'
const price = PRICES[MODEL]
if (!price) {
  console.error(`no price table for model "${MODEL}" — add it to server/scripts/draft-cost.js`)
  process.exit(2)
}

const args = process.argv.slice(2)
let dates
if (args.includes('--all')) {
  dates = (await fs.readdir(draftsDir))
    .filter((f) => /^due-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(4, 14))
    .sort()
} else {
  dates = [args[0] ?? new Date().toISOString().slice(0, 10)]
}

const usd = (n) => '$' + n.toFixed(2)
let grandTotal = 0

for (const date of dates) {
  let day
  try {
    day = JSON.parse(await fs.readFile(path.join(draftsDir, `due-${date}.json`), 'utf8'))
  } catch {
    console.error(`no day file for ${date}`)
    continue
  }
  const entries = day.drafts ?? []
  const t = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
  let priced = 0
  for (const e of entries) {
    if (!e.usage) continue
    priced++
    for (const k of Object.keys(t)) t[k] += e.usage[k] ?? 0
  }

  const cost =
    (t.input_tokens * price.input +
      t.output_tokens * price.output +
      t.cache_creation_input_tokens * price.cacheWrite +
      t.cache_read_input_tokens * price.cacheRead) /
    1e6
  grandTotal += cost

  const unpriced = entries.length - priced
  console.log(`\n${date}  ${entries.length} drafts (${priced} with usage${unpriced ? `, ${unpriced} unpriced` : ''})  model ${MODEL}`)
  if (!priced) {
    console.log('  no usage recorded — this day predates usage logging')
    continue
  }
  const rows = [
    ['fresh input', t.input_tokens, (t.input_tokens * price.input) / 1e6],
    ['cache write', t.cache_creation_input_tokens, (t.cache_creation_input_tokens * price.cacheWrite) / 1e6],
    ['cache read', t.cache_read_input_tokens, (t.cache_read_input_tokens * price.cacheRead) / 1e6],
    ['output', t.output_tokens, (t.output_tokens * price.output) / 1e6],
  ]
  for (const [label, tokens, c] of rows) {
    const pct = cost ? ((c / cost) * 100).toFixed(0) : '0'
    console.log(`  ${label.padEnd(12)} ${String(tokens).padStart(11)} tok  ${usd(c).padStart(8)}  ${pct.padStart(3)}%`)
  }
  console.log(`  ${'TOTAL'.padEnd(12)} ${''.padStart(11)}      ${usd(cost).padStart(8)}`)
  console.log(`  per draft: ${usd(cost / priced)}   avg output: ${Math.round(t.output_tokens / priced)} tok`)
}

if (dates.length > 1) console.log(`\nall days: ${usd(grandTotal)}`)
