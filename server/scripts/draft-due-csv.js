// Morning batch: draft every flow message due today from the Groove due-list.
//
// Groove (Flows → due) exports one row per person due:
//   Name,Email,SFDC ID,Account,Current Step,Managed By,Added By
// e.g. Current Step = "Day 4 - Send email template: Jan Email 2".
//
//   npm run draft:due -- "data/BDR 2 FY27 - all - Due - 2026-07-27.csv" --dry-run
//   npm run draft:due -- "data/BDR 2 FY27 - all - Due - 2026-07-27.csv"
//   npm run draft:due -- "<csv>" --accounts "Button" --limit 5
//
// Per row: resolve the tracker contact (SFDC ID → email → name+account;
// unknown contacts are created, with title/persona pulled from the Groove
// mirror). Being on the due list IS the schedule, so each resolved row is
// stamped nextAction = Current Step, nextDate = today — #/accounts and
// #/day stay current with zero manual next-step upkeep. Then run
// /api/draft kind=next with the due step — the engine
// builds full context itself (dossier, persona profile, touch history /
// last messages sent, account flags). Sequential, unattended; a failed row
// is recorded and never blocks the rest.
//
// Output: data/drafts/due-<date>.json + due-<date>.md (paste-ready).
// Cost: one low-effort call per contact (~10-30s each) — --limit caps it.
import fs from 'node:fs/promises'
import path from 'node:path'
import { config, paths } from '../lib/config.js'
import { parseCsv } from '../lib/csv.js'
import * as store from '../lib/trackerStore.js'

const args = process.argv.slice(2)
const file = args.find((a) => !a.startsWith('--'))
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}
if (!file) {
  console.error('usage: npm run draft:due -- <csv path> [--dry-run] [--accounts "A,B"] [--limit N]')
  process.exit(1)
}
const DRY = flag('dry-run')
const ONLY = opt('accounts')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const LIMIT = opt('limit') ? parseInt(opt('limit'), 10) : Infinity

const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const BASE = `http://${config.server.host}:${config.server.port}`
let useApi = false
try {
  useApi = (await fetch(`${BASE}/api/health`)).ok
} catch {
  /* server down */
}
if (!useApi && !DRY) {
  console.error('drafting goes through /api/draft — start the server first (launchctl kickstart or npm start)')
  process.exit(1)
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
const patchContact = (id, p) => (useApi ? apiCall('PATCH', `/api/tracker/contacts/${id}`, p) : store.patchContact(id, p))

// ---------- parse + resolve ----------
const raw = await fs.readFile(file, 'utf8')
let rows = parseCsv(raw).filter((r) => r.Name && r.Account)
if (ONLY) rows = rows.filter((r) => ONLY.includes(r.Account.toLowerCase()))

// A person can be due for MORE than one step on the same day — Groove
// exports one row per due step (e.g. Day 2 = Cold Call 1 AND Email 1), so
// dedupe on person+step: exact duplicate rows collapse, distinct steps all
// get drafted.
const personKey = (r) => r['SFDC ID'] || r.Email?.toLowerCase() || `${r.Account}|${r.Name}`.toLowerCase()
const seen = new Set()
rows = rows.filter((r) => {
  const k = `${personKey(r)}|${(r['Current Step'] ?? '').toLowerCase()}`
  if (seen.has(k)) return false
  seen.add(k)
  return true
})

// Every step a person is due for, so the nextAction stamp shows all of them.
const stepsByPerson = new Map()
for (const r of rows) {
  const s = r['Current Step'] || null
  if (!s) continue
  const k = personKey(r)
  if (!stepsByPerson.has(k)) stepsByPerson.set(k, [])
  if (!stepsByPerson.get(k).includes(s)) stepsByPerson.get(k).push(s)
}

const existing = await store.readStore()
const bySfId = new Map(existing.contacts.filter((c) => c.sfContactId).map((c) => [c.sfContactId, c]))
const byEmail = new Map(existing.contacts.filter((c) => c.email).map((c) => [c.email.toLowerCase(), c]))
const byNameAcct = new Map(existing.contacts.filter((c) => c.name).map((c) => [`${c.accountId}|${c.name.toLowerCase()}`, c]))
const accountByName = new Map(existing.accounts.map((a) => [a.name.toLowerCase(), a.id]))

// The Groove mirror supplies title (→ persona) for contacts we have to create.
let mirrorBySfId = new Map()
try {
  const mirror = JSON.parse(await fs.readFile(path.join(paths.dataDir, 'outreach.json'), 'utf8'))
  mirrorBySfId = new Map(mirror.contacts.filter((c) => c.sf_contact_id).map((c) => [c.sf_contact_id, c]))
} catch {
  /* no mirror — creates just get no title/persona */
}

console.log(`${path.basename(file)}: ${rows.length} due` + (DRY ? ' [DRY RUN]' : '') + ` | writes: ${useApi ? 'server API' : 'direct'}`)

const targets = [] // [{row, contact}]
const today = new Date().toLocaleDateString('en-CA')
// A person with two due steps yields two rows — resolve/create/stamp them
// once, then reuse the contact for their later rows.
const resolvedThisRun = new Map() // personKey → contact
let created = 0
let stamped = 0
for (const r of rows) {
  const sfId = r['SFDC ID'] || null
  const accountId = accountByName.get(r.Account.toLowerCase()) ?? null
  const pk = personKey(r)
  // Due today = the schedule. Stamped on every resolved person (created or
  // matched) so the Accounts/Day views track Groove without manual entry.
  // All of today's steps joined, e.g. "Day 2 - Cold Call 1 + Day 2 - Send…".
  const due = { nextAction: stepsByPerson.get(pk)?.join(' + ') || null, nextDate: today }
  if (resolvedThisRun.has(pk)) {
    targets.push({ row: r, contact: resolvedThisRun.get(pk) })
    continue
  }
  let contact =
    (sfId && bySfId.get(sfId)) ||
    (r.Email && byEmail.get(r.Email.toLowerCase())) ||
    (accountId && byNameAcct.get(`${accountId}|${r.Name.toLowerCase()}`)) ||
    null
  if (!contact) {
    const mirrorEntry = sfId ? mirrorBySfId.get(sfId) : null
    const title = mirrorEntry?.title ?? null
    const persona = title ? store.personaForTitle(title) : null
    let acctId = accountId
    if (!acctId) {
      acctId = slugify(r.Account)
      if (DRY) console.log(`  + account ${r.Account} (${acctId})`)
      else await addAccount({ id: acctId, name: r.Account })
      accountByName.set(r.Account.toLowerCase(), acctId)
    }
    if (DRY) {
      console.log(`  + contact ${r.Name} (${title ?? 'no title'}) → ${persona ?? 'no persona'}`)
      contact = { id: `(new)`, accountId: acctId, name: r.Name }
    } else {
      const res = await addContact({ accountId: acctId, name: r.Name, title, email: r.Email || null, sfContactId: sfId, persona, ...due })
      contact = res.contact ?? res
    }
    created++
  } else if (!DRY && (contact.nextAction !== due.nextAction || contact.nextDate !== due.nextDate)) {
    const res = await patchContact(contact.id, due)
    contact = res?.contact ?? res ?? contact
    stamped++
  }
  resolvedThisRun.set(pk, contact)
  targets.push({ row: r, contact })
}
console.log(`resolved: ${targets.length - created} matched, ${created} created` + (DRY ? '' : ` · next step/date stamped on ${stamped + created}`))

if (DRY) {
  for (const { row, contact } of targets) {
    console.log(`  ${row.Name} @ ${row.Account} [${contact.id}] — ${row['Current Step']}`)
  }
  process.exit(0)
}

// ---------- draft pass (sequential — one low-effort call per contact) ----------
const capped = targets.slice(0, LIMIT)
if (capped.length < targets.length) console.log(`--limit ${LIMIT}: drafting ${capped.length} of ${targets.length}`)
console.log(`drafting ${capped.length} message(s)…`)

const date = new Date().toISOString().slice(0, 10)
const outDir = path.join(paths.dataDir, 'drafts')
const jsonFile = path.join(outDir, `due-${date}.json`)

// A day-file entry is one contact × one step (a person can hold both a call
// script and an email draft for the same day).
const entryKey = (contactId, step) => `${contactId}|${step ?? ''}`

// Colleagues at one account compare inboxes — every draft sees what was
// already written for that account (earlier today + this run) and must take
// a different angle. Prior entries being redrafted right now don't count.
const targetKeys = new Set(capped.map((t) => entryKey(t.contact.id, t.row['Current Step'] || null)))
let prior = []
try {
  prior = JSON.parse(await fs.readFile(jsonFile, 'utf8')).drafts ?? []
} catch {
  /* first run today */
}
const summarize = (e) => {
  const opening = (e.draft.body ?? '').split('\n')[0].slice(0, 120)
  return `- ${e.name}: play=${e.draft.play}, subject="${e.draft.subject ?? '—'}", opening="${opening}"`
}
const historyByAccount = new Map()
const rememberDraft = (account, entry) => {
  if (!historyByAccount.has(account)) historyByAccount.set(account, [])
  historyByAccount.get(account).push(summarize(entry))
}
for (const e of prior) {
  if (e.draft && !targetKeys.has(entryKey(e.contactId, e.step))) rememberDraft(e.account, e)
}

const results = []
for (const { row, contact } of capped) {
  process.stdout.write(`  ${row.Name} @ ${row.Account} … `)
  const entry = {
    name: row.Name,
    email: row.Email || null,
    account: row.Account,
    accountId: contact.accountId,
    contactId: contact.id,
    step: row['Current Step'] || null,
  }
  const history = historyByAccount.get(row.Account) ?? []
  try {
    const res = await fetch(`${BASE}/api/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contactId: contact.id,
        kind: 'next',
        dueStep: row['Current Step'] || undefined,
        batchContext: history.length ? history.slice(-10).join('\n') : undefined,
      }),
    })
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
    let done = null
    for (const line of (await res.text()).split('\n')) {
      if (!line.trim()) continue
      const evt = JSON.parse(line)
      if (evt.type === 'done') done = evt
      if (evt.type === 'error') throw new Error(evt.error)
    }
    if (!done?.draft?.body) throw new Error('no parsed draft')
    entry.draft = done.draft
    results.push(entry)
    rememberDraft(row.Account, entry)
    console.log(`✓ ${done.draft.play} (${done.draft.channel})${done.draft.flag_warnings?.length ? ` ⚑${done.draft.flag_warnings.length}` : ''}`)
  } catch (err) {
    entry.error = err.message
    results.push(entry)
    console.log(`✗ ${err.message}`)
  }
}

// ---------- write outputs (merge into the day file — partial re-runs keep the rest) ----------
await fs.mkdir(outDir, { recursive: true })
// Re-read the day file fresh: "sent" marks made from the Due page while this
// batch ran must survive the write. Rows re-drafted this run start unsent.
let fresh = prior
try {
  fresh = JSON.parse(await fs.readFile(jsonFile, 'utf8')).drafts ?? []
} catch {
  /* first run today */
}
const mergedMap = new Map()
for (const e of fresh) mergedMap.set(entryKey(e.contactId ?? e.name, e.step), e)
for (const r of results) mergedMap.set(entryKey(r.contactId ?? r.name, r.step), r)
const merged = [...mergedMap.values()]

await fs.writeFile(
  jsonFile,
  JSON.stringify({ date, source: path.basename(file), generated_at: new Date().toISOString(), drafts: merged }, null, 2)
)

const ok = merged.filter((r) => r.draft)
const failed = merged.filter((r) => r.error)
const md = [`# Due drafts — ${date}`, '', `${merged.length} due · ${ok.length} drafted · ${failed.length} failed`]
const byAccount = new Map()
for (const r of merged) {
  if (!byAccount.has(r.account)) byAccount.set(r.account, [])
  byAccount.get(r.account).push(r)
}
for (const [account, list] of byAccount) {
  md.push('', `## ${account} (${list.length})`)
  const flags = [...new Set(list.flatMap((r) => r.draft?.flag_warnings ?? []))]
  for (const f of flags) md.push('', `> ⚑ ${f}`)
  for (const r of list) {
    md.push('', `### ${r.name} — ${r.step ?? 'due'}`)
    if (r.error) {
      md.push('', `**FAILED:** ${r.error} — draft by hand in the send desk.`)
      continue
    }
    md.push('', `_${r.draft.play} · ${r.draft.channel}_`)
    if (r.draft.subject) md.push('', `**Subject:** ${r.draft.subject}`)
    md.push('', '```', r.draft.body, '```')
  }
}
const mdFile = path.join(outDir, `due-${date}.md`)
await fs.writeFile(mdFile, md.join('\n') + '\n')

console.log(
  `\ndone: ${results.filter((r) => r.draft).length}/${results.length} drafted this run — day file: ${ok.length} drafted` +
    (failed.length ? `, ${failed.length} failed (kept)` : '') +
    ` of ${merged.length}`
)
console.log(`  ${jsonFile}`)
console.log(`  ${mdFile}`)
