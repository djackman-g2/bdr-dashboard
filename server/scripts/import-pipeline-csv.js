// Monday-pipeline CSV intake + upgrade pass.
//
// The ops "BDR Weekly Pipeline" workflow emails a CSV every Monday (~6am CT):
// one row per contact with title,full_name,company_name,email,flow.first_name,
// flow.email1_subject,flow.email1_body,flow.email2_subject,flow.email2_body,
// flow.email3_subject,flow.email3_body,flow.linkedinmail_body,salesforce_id.
//
//   npm run import:pipeline -- "data/inbox/pipeline.csv" --dry-run
//   npm run import:pipeline -- "data/inbox/pipeline.csv"
//   npm run import:pipeline -- "data/inbox/pipeline.csv" --accounts "Elastic Path,Gurobi"
//   npm run import:pipeline -- "data/inbox/pipeline.csv" --upgrade 5
//
// Import: creates guest tracker accounts (id = slugified company) + contacts
// (persona guessed from the CSV title, email kept). Idempotent — existing
// accounts/contacts (by name/email) are skipped. API-first like seed-tracker.
//
// --upgrade N: regenerate the flow messaging for the first N imported
// contacts through the drafting engine (anatomy + canonical stats + dossier
// when one exists) and write <file>-upgraded.csv with the SAME columns, ready
// to paste into the Groove {!flow.*} fields. Each pack is one Opus call
// (~30-60s) — N is a deliberate cost lever, never defaulted to "all".
import fs from 'node:fs/promises'
import path from 'node:path'
import { config, paths } from '../lib/config.js'
import * as store from '../lib/trackerStore.js'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}
if (!file) {
  console.error('usage: npm run import:pipeline -- <csv path> [--dry-run] [--accounts "A,B"] [--upgrade N]')
  process.exit(1)
}
const DRY = flag('dry-run')
const ONLY = opt('accounts')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const UPGRADE = opt('upgrade') ? parseInt(opt('upgrade'), 10) : 0

// ---------- minimal RFC-4180 CSV (quoted fields hold multiline HTML) ----------
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') {
      row.push(field)
      field = ''
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field)
      field = ''
      if (row.some((f) => f !== '')) rows.push(row)
      row = []
    } else field += c
  }
  if (field !== '' || row.length) {
    row.push(field)
    if (row.some((f) => f !== '')) rows.push(row)
  }
  const header = rows.shift()
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])))
}

const csvField = (v) => {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

// ---------- server-or-direct writes (same pattern as seed-tracker) ----------
const BASE = `http://${config.server.host}:${config.server.port}`
let useApi = false
try {
  useApi = (await fetch(`${BASE}/api/health`)).ok
} catch {
  /* server down — direct writes */
}

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
const addAccount = (a) => (useApi ? apiCall('POST', '/api/tracker/accounts', a) : store.addAccount(a))
const addContact = (c) => (useApi ? apiCall('POST', '/api/tracker/contacts', c) : store.addContact(c))

// ---------- import ----------
const raw = await fs.readFile(file, 'utf8')
const rows = parseCsv(raw).filter((r) => r.company_name && r.full_name)
const filtered = ONLY ? rows.filter((r) => ONLY.includes(r.company_name.toLowerCase())) : rows
console.log(`${path.basename(file)}: ${rows.length} rows, ${new Set(rows.map((r) => r.company_name)).size} accounts` +
  (ONLY ? ` → filtered to ${filtered.length} rows` : '') + (DRY ? ' [DRY RUN]' : '') +
  ` | writes: ${useApi ? 'server API' : 'direct'}`)

const existing = await store.readStore()
const accountByName = new Map(existing.accounts.map((a) => [a.name.toLowerCase(), a.id]))
const contactKeys = new Set(
  existing.contacts.flatMap((c) => [c.email?.toLowerCase(), c.name && `${c.accountId}|${c.name.toLowerCase()}`]).filter(Boolean)
)

let accountsAdded = 0
let contactsAdded = 0
let skipped = 0
const imported = [] // [{row, contactId, accountId}] for the upgrade pass

for (const r of filtered) {
  let accountId = accountByName.get(r.company_name.toLowerCase())
  if (!accountId) {
    accountId = slugify(r.company_name)
    if (DRY) console.log(`  + account ${r.company_name} (${accountId})`)
    else await addAccount({ id: accountId, name: r.company_name })
    accountByName.set(r.company_name.toLowerCase(), accountId)
    accountsAdded++
  }
  const key = r.email?.toLowerCase() || `${accountId}|${r.full_name.toLowerCase()}`
  if (contactKeys.has(r.email?.toLowerCase()) || contactKeys.has(`${accountId}|${r.full_name.toLowerCase()}`)) {
    skipped++
    // still eligible for upgrade — find the existing row
    const c = existing.contacts.find(
      (x) => x.email?.toLowerCase() === r.email?.toLowerCase() ||
             (x.accountId === accountId && x.name?.toLowerCase() === r.full_name.toLowerCase())
    )
    if (c) imported.push({ row: r, contactId: c.id })
    continue
  }
  contactKeys.add(key)
  const persona = store.personaForTitle(r.title)
  if (DRY) {
    console.log(`    + ${r.full_name} (${r.title || '—'}) → ${persona ?? 'no persona'}`)
    contactsAdded++
  } else {
    const res = await addContact({ accountId, name: r.full_name, title: r.title || null, email: r.email || null, persona })
    imported.push({ row: r, contactId: res.contact?.id ?? res.id })
    contactsAdded++
  }
}
console.log(`import done: ${accountsAdded} accounts, ${contactsAdded} contacts added, ${skipped} already present${DRY ? ' (dry run)' : ''}`)

// ---------- upgrade pass ----------
if (UPGRADE > 0 && !DRY) {
  if (!useApi) {
    console.error('--upgrade needs the server running (drafting goes through /api/draft)')
    process.exit(1)
  }
  const targets = imported.slice(0, UPGRADE)
  console.log(`upgrading messaging for ${targets.length} contact(s) — one Opus call each, ~30-60s…`)
  const header = 'title,full_name,company_name,email,flow.first_name,flow.email1_subject,flow.email1_body,flow.email2_subject,flow.email2_body,flow.email3_subject,flow.email3_body,flow.linkedinmail_body,salesforce_id'
  const outLines = [header]
  const toHtml = (s) => String(s ?? '').replace(/\n/g, '<br>')

  for (const { row, contactId } of targets) {
    process.stdout.write(`  ${row.full_name} @ ${row.company_name} … `)
    try {
      // /api/draft streams NDJSON — read to the end, keep the done event.
      const res = await fetch(`${BASE}/api/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactId, kind: 'pack' }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
      let done = null
      for (const line of (await res.text()).split('\n')) {
        if (!line.trim()) continue
        const evt = JSON.parse(line)
        if (evt.type === 'done') done = evt
        if (evt.type === 'error') throw new Error(evt.error)
      }
      const d = done?.draft
      if (!d?.emails?.length) throw new Error('no parsed pack')
      const [e1, e2, e3] = d.emails
      outLines.push([
        row.title, row.full_name, row.company_name, row.email, row['flow.first_name'],
        e1?.subject, toHtml(e1?.body), e2?.subject, toHtml(e2?.body), e3?.subject, toHtml(e3?.body),
        toHtml(d.linkedin_inmail), row.salesforce_id,
      ].map(csvField).join(','))
      console.log(`✓ ${d.play}${d.flag_warnings?.length ? ` ⚑${d.flag_warnings.length}` : ''}`)
    } catch (err) {
      console.log(`✗ ${err.message} — keeping ops copy for this row`)
      outLines.push([
        row.title, row.full_name, row.company_name, row.email, row['flow.first_name'],
        row['flow.email1_subject'], row['flow.email1_body'], row['flow.email2_subject'], row['flow.email2_body'],
        row['flow.email3_subject'], row['flow.email3_body'], row['flow.linkedinmail_body'], row.salesforce_id,
      ].map(csvField).join(','))
    }
  }
  const outFile = file.replace(/\.csv$/i, '') + '-upgraded.csv'
  await fs.writeFile(outFile, outLines.join('\n') + '\n')
  console.log(`upgraded CSV written: ${outFile} (${outLines.length - 1} rows) — paste into Groove flow fields at enrollment`)
}
