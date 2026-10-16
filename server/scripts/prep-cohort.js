#!/usr/bin/env node
// Pre-flight for newly enrolled accounts (2026-09-08).
//
// The gap this closes: Declan enrolls five accounts on Monday, connects on
// LinkedIn, and by Tuesday morning the Groove flow wants a real message for
// every one of them. Those accounts have no dossier, no storyline, and (before
// today's Title fix) no persona — so the morning batch drafted them from play +
// persona + canonical stats alone. Deep research would fix it at $8-11 each,
// which is the whole reason the spend cut happened. This does it for ~$0.50:
//
//   1. Read the enrolled roster from Groove (a READ — allowed unattended per
//      Declan's 2026-08-25 ruling; writes stay hand-invoked). That roster is
//      the cast, with real titles, free.
//   2. Write data/groove/cast/<slug>.json, which storylineBuilder.js reads.
//   3. Queue a `brief` refresh per account through the server's own queue, so
//      the one-concurrent-run and daily-cap guarantees stay in one place.
//      ai_visibility (config.ai_visibility.run_after_brief) and the storyline
//      auto-build (config.storyline.auto_build_after_brief) both fire off the
//      back of that job — no extra orchestration here.
//
// usage:
//   node scripts/prep-cohort.js --tomorrow            # everyone due in <=1 day
//   node scripts/prep-cohort.js AnyRoad WorkSpan ...  # named accounts
//   node scripts/prep-cohort.js --tomorrow --dry-run  # roster only, no queueing
//   node scripts/prep-cohort.js AnyRoad --roster-only # write cast files, skip refresh
import fs from 'node:fs/promises'
import path from 'node:path'
import * as groove from '../lib/groove.js'
import { config, paths } from '../lib/config.js'
import { resolveIndexSlug, normalizeAccountName } from '../lib/accountSlug.js'

const argv = process.argv.slice(2)
const flag = (n) => argv.includes(`--${n}`)
const DRY = flag('dry-run')
const ROSTER_ONLY = flag('roster-only')
const TOMORROW = flag('tomorrow')
const names = argv.filter((a) => !a.startsWith('--'))

if (!TOMORROW && !names.length) {
  console.error('usage: prep-cohort.js [--tomorrow | <account names...>] [--dry-run] [--roster-only]')
  process.exit(1)
}

const CAST_DIR = path.join(paths.dataDir, 'groove', 'cast')
const PORT = config.server?.port ?? 5173
const BASE = `http://127.0.0.1:${PORT}`

// Every flow, both filters — a person enrolled today can sit in either, and
// Eltropy-style accounts span two flows at once. Two GETs per flow per filter,
// nothing against the write limits.
async function pullAllRows() {
  const flows = (await groove.listFlows()).data ?? []
  const rows = []
  for (const f of flows) {
    for (const filter of ['due_today', 'not_yet_due']) {
      let page = 1
      while (true) {
        const r = await groove.getDueContacts({ flowId: f.id, filter, page, perPage: 100 })
        const batch = r.data ?? []
        for (const p of batch) rows.push({ ...p, flow_id: f.id, flow_name: f.name, filter })
        if (batch.length < 100) break
        page++
      }
    }
  }
  return rows
}

const rows = await pullAllRows()
console.log(`pulled ${rows.length} enrolled row(s) across all flows`)

// Which accounts are we prepping?
let wanted
if (TOMORROW) {
  const soon = rows.filter((r) => (r.days_until_due ?? 0) <= 1)
  wanted = [...new Set(soon.map((r) => r.company).filter(Boolean))]
  console.log(`--tomorrow: ${wanted.length} account(s) with someone due within 1 day`)
} else {
  wanted = names
}

const results = []
for (const name of wanted) {
  const key = normalizeAccountName(name)
  const mine = rows.filter((r) => normalizeAccountName(r.company) === key)
  if (!mine.length) {
    console.log(`  ${name.padEnd(22)} — no enrolled contacts found in any flow, skipping`)
    results.push({ name, status: 'no-roster' })
    continue
  }
  const slug = await resolveIndexSlug(mine[0].company) ?? (await resolveIndexSlug(name))
  if (!slug) {
    // Not in data/index.json at all — no dossier can be written for it, and
    // guessing a slug here would create a dossier the workbench never shows.
    console.log(`  ${name.padEnd(22)} — NOT in data/index.json (run refresh:book, or add an alias), skipping`)
    results.push({ name, status: 'no-index-row' })
    continue
  }

  // Dedupe by SFDC id (a person in two flows is one cast member).
  const byPerson = new Map()
  for (const r of mine) {
    const id = r.sfdc_id || r.email || r.name
    const c = byPerson.get(id) ?? {
      name: r.name,
      title: r.title ?? null,
      email: r.email ?? null,
      sfdc_id: r.sfdc_id ?? null,
      groove_person_id: r.id ?? null,
      flows: [],
    }
    const tag = `${r.flow_name} (${r.filter}${r.days_until_due ? `, due in ${r.days_until_due}d` : ''})`
    if (!c.flows.includes(tag)) c.flows.push(tag)
    byPerson.set(id, c)
  }
  const contacts = [...byPerson.values()]
  const missingTitle = contacts.filter((c) => !c.title).length

  const roster = {
    slug,
    account: mine[0].company,
    pulled_at: new Date().toISOString(),
    source: 'groove due-list (read-only)',
    contacts,
  }
  if (!DRY) {
    await fs.mkdir(CAST_DIR, { recursive: true })
    const file = path.join(CAST_DIR, `${slug}.json`)
    const tmp = file.replace(/\.json$/, '.tmp.json') // never *.json.tmp — ajv reads those as JS
    await fs.writeFile(tmp, JSON.stringify(roster, null, 2) + '\n')
    await fs.rename(tmp, file)
  }
  console.log(
    `  ${roster.account.padEnd(22)} ${slug.padEnd(22)} ${contacts.length} cast` +
      (missingTitle ? ` (${missingTitle} without a title)` : '') +
      (contacts.some((c) => c.flows.length > 1) ? ' [spans 2 flows]' : '')
  )
  results.push({ name: roster.account, slug, status: 'roster', cast: contacts.length })
}

const ready = results.filter((r) => r.status === 'roster')
if (DRY) {
  console.log(`\ndry run — wrote nothing, queued nothing. ${ready.length} account(s) would be prepped.`)
  process.exit(0)
}
console.log(`\nwrote ${ready.length} cast file(s) to data/groove/cast/`)
if (ROSTER_ONLY) process.exit(0)

// Queue the research through the server so the queue/cap guarantees stay in
// one place (CLAUDE.md: never a second queue). brief takes no deep-cap slot.
console.log(`\nqueueing brief refreshes via ${BASE} (one at a time, ~5-10 min each)…`)
let queued = 0
for (const r of ready) {
  try {
    const res = await fetch(`${BASE}/api/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: r.slug, mode: 'brief', origin: 'user' }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok || body.error) {
      console.log(`  ${r.slug.padEnd(22)} NOT queued — ${body.error ?? res.status}`)
    } else {
      queued++
      console.log(`  ${r.slug.padEnd(22)} queued (job ${body.id ?? body.job?.id ?? '?'})`)
    }
  } catch (err) {
    console.log(`  ${r.slug.padEnd(22)} NOT queued — server unreachable at ${BASE} (${err.message})`)
  }
}
console.log(
  `\n${queued}/${ready.length} queued. Each brief writes the dossier, then ai_visibility and the` +
    ` storyline auto-build fire off the back of it. Watch: tail -f ~/Library/Logs/bdr-dashboard/server.log`
)
