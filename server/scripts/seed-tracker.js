// Seed the outreach tracker's account rows from data/index.json — the
// research index already holds the full FY27 book (slug, name, status), so
// there's no CSV export step. Researched accounts also get sfId/g2Slug and
// (with --contacts) their dossier's icp_contacts imported as contact rows.
//
// Usage (from server/):
//   npm run seed:tracker                          # accounts with status=active
//   npm run seed:tracker -- --slugs cresta-com,matik-io --contacts
//   npm run seed:tracker -- --status pending_research   # or --all (whole book)
//   npm run seed:tracker -- --dry-run
//
// Writes go through the running server's API when it's up (its store writes
// are serialized, so this can't race a live activity log); direct store
// writes are the fallback when it isn't.
import fs from 'node:fs/promises'
import path from 'node:path'
import { config, paths } from '../lib/config.js'
import * as store from '../lib/trackerStore.js'

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}

const DRY = flag('dry-run')
const WANT_CONTACTS = flag('contacts')
const SLUGS = opt('slugs')?.split(',').map((s) => s.trim()).filter(Boolean)
const STATUS = flag('all') ? null : (opt('status') ?? 'active')

const BASE = `http://${config.server.host}:${config.server.port}/api/tracker`

// ---------- server-or-direct write layer ----------
let useApi = false
try {
  useApi = (await fetch(`${BASE.replace('/api/tracker', '/api/health')}`)).ok
} catch {
  /* server down — direct writes */
}
console.log(`writes: ${DRY ? 'DRY RUN' : useApi ? `server API (${BASE})` : 'direct to data/tracker.json (server down)'}`)

async function apiCall(method, url, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error ?? `${method} ${url}: HTTP ${res.status}`)
  return json
}

const addAccount = (a) => (useApi ? apiCall('POST', '/accounts', a) : store.addAccount(a))
const addContact = (c) => (useApi ? apiCall('POST', '/contacts', c) : store.addContact(c))

// ---------- seed accounts ----------
const index = JSON.parse(await fs.readFile(paths.index, 'utf8'))
const rows = index.accounts.filter((a) => {
  if (a.status === 'archived') return false // never work archived accounts
  if (SLUGS) return SLUGS.includes(a.slug)
  return STATUS ? a.status === STATUS : true
})
console.log(`index: ${index.accounts.length} entries → seeding ${rows.length} (${SLUGS ? `slugs: ${SLUGS.join(',')}` : STATUS ? `status=${STATUS}` : 'all non-archived'})`)

async function readDossier(slug) {
  try {
    return JSON.parse(await fs.readFile(path.join(paths.accountsDir, `${slug}.json`), 'utf8'))
  } catch {
    return null // pending_research accounts have index stubs only
  }
}

const existing = new Set((await store.readStore()).accounts.map((a) => a.id))
let added = 0
let skipped = 0
let contactsAdded = 0

for (const row of rows) {
  const dossier = await readDossier(row.slug)
  const account = {
    id: row.slug,
    name: row.name,
    sfId: dossier?.salesforce?.account_id ?? null,
    g2Slug: dossier?.g2?.vendor_slug ?? null,
    playType: null, // assign per-account in the dashboard — the play is a human call
    flags: [],
  }
  if (existing.has(account.id)) {
    skipped++
  } else if (DRY) {
    console.log(`  would add ${account.id} (${account.name})${dossier ? ' [dossier]' : ''}`)
    added++
  } else {
    const r = await addAccount(account)
    r.existed ? skipped++ : added++
  }

  // Contact rows from the dossier's ICP contacts — persona guessed from
  // title, hook left empty (the hook is persona angle × pulled proof, and
  // writing it is deliberately a human step: no hook, no advance).
  if (WANT_CONTACTS && dossier?.icp_contacts?.length) {
    const have = new Set(
      (await store.readStore()).contacts.filter((c) => c.accountId === row.slug).map((c) => c.name?.toLowerCase())
    )
    for (const ic of dossier.icp_contacts) {
      if (!ic.name || have.has(ic.name.toLowerCase())) continue
      const contact = {
        accountId: row.slug,
        name: ic.name,
        title: ic.title ?? null,
        persona: store.personaForTitle(ic.title),
      }
      if (DRY) console.log(`    would add contact ${ic.name} (${ic.title ?? '—'}) → ${contact.persona ?? 'no persona match'}`)
      else await addContact(contact)
      contactsAdded++
    }
  }
}

console.log(`done: ${added} accounts added, ${skipped} already present${WANT_CONTACTS ? `, ${contactsAdded} contacts imported` : ''}${DRY ? ' (dry run — nothing written)' : ''}`)

// ---------- enrichment stubs (wire later) ----------
// Deliberate placeholders — the live fill paths already exist elsewhere and
// should be reused rather than reimplemented here:
//  - Salesforce:  the pipeline's activity/light runs (server /api/refresh);
//    this layer never talks to SF directly, and never writes to it.
//  - ZoomInfo:    POST /api/refresh {mode:'section', section:'contacts'} —
//    free search_contacts → capped paid enrich_contacts, credits logged.
//    Then re-run this script with --contacts to pull the new names in.
//  - G2 proof:    personas[persona].proofToPull names what to fetch (Grid
//    position, review-volume gap, intent counts) — candidate source is the
//    dossier's g2 + ai_visibility sections, refreshed via section runs.
/* eslint-disable no-unused-vars */
async function enrichContactsFromSalesforce(slug) {
  throw new Error('not wired — SF data arrives via the research pipeline, read-only')
}
async function enrichContactsFromZoomInfo(slug) {
  throw new Error('not wired — use POST /api/refresh {mode:"section", section:"contacts"}')
}
async function pullProofForPersona(slug, persona) {
  throw new Error('not wired — proofToPull comes from the dossier g2/ai_visibility sections')
}
