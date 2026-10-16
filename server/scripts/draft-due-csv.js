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
  console.error('usage: npm run draft:due -- <csv path> [--dry-run] [--accounts "A,B"] [--limit N] [--skip-drafted]')
  process.exit(1)
}
const DRY = flag('dry-run')
const ONLY = opt('accounts')?.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
const LIMIT = opt('limit') ? parseInt(opt('limit'), 10) : Infinity
// Top-up mode. Groove's due_today list GROWS through the day — the 7am pull is
// a snapshot, and people whose step comes due at 10am are simply not in it
// (verified 2026-09-04: 177 pulled at 06:46, 212 due by 09:24, and every step
// the extra 35 sat on was already in the morning pull, so nothing was dropped
// — they just weren't due yet). Re-running the pull later catches them, but a
// plain re-run would also re-draft everything already done. With this flag,
// rows that already hold a successful draft in today's day file are skipped.
const SKIP_DRAFTED = flag('skip-drafted')

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
// Same guard as POST /api/draft-due: a CSV without steps (Groove people/
// manual-import export) makes every draft a channel/step guess.
if (rows.length && rows.every((r) => !r['Current Step'])) {
  console.error('no "Current Step" values — this looks like a Groove people export, not the Flows → due list. Re-export the due list so each row carries its step.')
  process.exit(1)
}
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

// Accounts created here must carry the research-index slug when the name
// matches a dossier (same resolution as trackerStore.watchContact) — the
// draft engine loads data/accounts/{accountId}.json, so a slugified Groove
// name that drifts from the dossier slug silently drops ALL research from
// every draft for that account.
let researchSlugByName = new Map()
try {
  const index = JSON.parse(await fs.readFile(path.join(paths.dataDir, 'index.json'), 'utf8'))
  researchSlugByName = new Map(
    (index.accounts ?? []).filter((a) => a.name && a.slug).map((a) => [a.name.toLowerCase(), a.slug])
  )
} catch {
  /* no research index — fall through to slugified names */
}

console.log(`${path.basename(file)}: ${rows.length} due` + (DRY ? ' [DRY RUN]' : '') + ` | writes: ${useApi ? 'server API' : 'direct'}`)

let targets = [] // [{row, contact}] — reassigned by --skip-drafted below
const today = new Date().toLocaleDateString('en-CA')
// A person with two due steps yields two rows — resolve/create/stamp them
// once, then reuse the contact for their later rows.
const resolvedThisRun = new Map() // personKey → contact
let created = 0
let stamped = 0
let backfilled = 0
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
    // The CSV's own Title column wins over the mirror: groove-due-pull.js now
    // carries Groove's live title, and a person enrolled today has no mirror
    // row at all (the SF sync predates the enrollment). Mirror stays the
    // fallback for hand-pasted CSVs that have no Title column.
    const mirrorEntry = sfId ? mirrorBySfId.get(sfId) : null
    const title = r.Title || mirrorEntry?.title || null
    const persona = title ? store.personaForTitle(title) : null
    let acctId = accountId
    if (!acctId) {
      acctId = researchSlugByName.get(r.Account.toLowerCase()) ?? slugify(r.Account)
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
  } else if (!DRY) {
    // Backfill title/persona on rows created before the CSV carried a Title
    // (or created from a mirror that had no row yet). A tracker contact with
    // no persona drafts without persona routing every single day until someone
    // notices, so repair it in place the first time Groove tells us the title.
    const patch = { ...due }
    if (r.Title && !contact.title) {
      patch.title = r.Title
      const p = store.personaForTitle(r.Title)
      if (p && !contact.persona) patch.persona = p
      backfilled++
    }
    const changed =
      contact.nextAction !== due.nextAction || contact.nextDate !== due.nextDate || patch.title !== undefined
    if (changed) {
      const res = await patchContact(contact.id, patch)
      contact = res?.contact ?? res ?? contact
      stamped++
    }
  }
  resolvedThisRun.set(pk, contact)
  targets.push({ row: r, contact })
}
console.log(
  `resolved: ${targets.length - created} matched, ${created} created` +
    (DRY ? '' : ` · next step/date stamped on ${stamped + created}`) +
    (backfilled ? ` · title/persona backfilled on ${backfilled}` : '')
)

if (DRY) {
  for (const { row, contact } of targets) {
    console.log(`  ${row.Name} @ ${row.Account} [${contact.id}] — ${row['Current Step']}`)
  }
  process.exit(0)
}

// ---------- draft pass (sequential — one low-effort call per contact) ----------
// Group by account before drafting (2026-09-03). draft.js puts the dossier and
// storyline in cache_control:ephemeral system blocks with a 5-minute TTL, but
// Groove's due list arrives in no useful order — so a ~10k-token dossier was
// being WRITTEN to cache at 1.25x for nearly every one of ~208 daily rows and
// almost never read back, which is strictly worse than not caching it. About
// 71 accounts cover those rows, so grouping turns ~208 cache writes into ~71
// writes plus ~137 reads at 0.1x. It also puts an account's colleagues
// adjacent, which is exactly what the batchContext anti-duplicate-opener
// guard below wants. Sorting happens before the --limit slice on purpose, so
// a limited run takes whole accounts rather than a scattering of rows.
targets.sort((a, b) =>
  (a.row.Account ?? '').localeCompare(b.row.Account ?? '') ||
  (a.row.Name ?? '').localeCompare(b.row.Name ?? '')
)
// Drop rows already drafted today (--skip-drafted). Read here, before the
// sort/slice, with local names: date/jsonFile/entryKey are const-declared
// further down, so touching them now would hit the temporal dead zone.
if (SKIP_DRAFTED) {
  const today = new Date().toISOString().slice(0, 10)
  const dayFile = path.join(paths.dataDir, 'drafts', `due-${today}.json`)
  let done = new Set()
  try {
    const prev = JSON.parse(await fs.readFile(dayFile, 'utf8')).drafts ?? []
    // Only a row with a real body counts as done — an errored or terminated
    // entry is exactly what a top-up should retry.
    done = new Set(prev.filter((e) => e.draft?.body).map((e) => `${e.contactId}|${e.step ?? ''}`))
  } catch {
    /* no day file yet — nothing to skip */
  }
  const before = targets.length
  targets = targets.filter((t) => !done.has(`${t.contact.id}|${t.row['Current Step'] || ''}`))
  console.log(`--skip-drafted: ${before - targets.length} already drafted today, ${targets.length} to draft`)
  if (!targets.length) {
    console.log('nothing new to draft — every due row already has a draft.')
    process.exit(0)
  }
}

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
  const body = e.draft.body ?? ''
  const opening = body.split('\n')[0].slice(0, 120)
  // Colleagues comparing inboxes notice a repeated stat as fast as a repeated
  // subject — surface every number the draft spent so the next one can't reuse it.
  const stats = [...new Set(body.match(/\d+(?:\.\d+)?(?:%|x\b)/gi) ?? [])].slice(0, 8)
  return (
    `- ${e.name}: play=${e.draft.play}, subject="${e.draft.subject ?? '—'}", opening="${opening}"` +
    (stats.length ? `, stats used: ${stats.join(', ')}` : '')
  )
}
const historyByAccount = new Map()
const rememberDraft = (account, entry) => {
  if (!historyByAccount.has(account)) historyByAccount.set(account, [])
  historyByAccount.get(account).push(summarize(entry))
}

// Opener MECHANIC, not wording: colleagues comparing inboxes clock "ran X
// through Claude" twice however it's reworded (2026-08-12 batch: 4 ActiveOps
// colleagues got the same shortlist-test opener, Lambda's 2 contacts got
// identical openers — the prose-only batchContext rule wasn't enough).
const mechanicOf = (body) => {
  const text = (body ?? '')
    .replace(/^\s*(hey|hi|hello)?[,\s]*[A-ZÀ-Ž][\w'’.-]*\s*[,—-]*\s*/i, '') // greeting/name
    .replace(/\s+/g, ' ')
    .trim()
  const first = text.split(/(?<=[.?!])\s/)[0]?.toLowerCase() ?? ''
  if (/\b(ran|asked|typed|put|tested|queried)\b.*\b(claude|chatgpt|an ai|ai model|llm|ai search)\b/.test(first)) return 'ran-ai-prompt'
  if (/\bhead-to-head\b|\bvs\.?\s/.test(first)) return 'head-to-head'
  if (/\breviews?\b.*\b(count|only|added|last|gap)\b|\bonly\b.*\breviews?\b/.test(first)) return 'review-count'
  if (/\b(saw|congrats|noticed)\b.*\b(news|launch|raise|funding|hire|joined|announce)/.test(first)) return 'news-react'
  // fallback: first five significant words
  return first.split(' ').filter((w) => w.length > 2).slice(0, 5).join(' ')
}
const mechanicsByAccount = new Map()
const rememberMechanic = (account, body) => {
  if (!mechanicsByAccount.has(account)) mechanicsByAccount.set(account, new Set())
  mechanicsByAccount.get(account).add(mechanicOf(body))
}

for (const e of prior) {
  if (e.draft && !targetKeys.has(entryKey(e.contactId, e.step))) {
    rememberDraft(e.account, e)
    rememberMechanic(e.account, e.draft.body)
  }
}

// Persist after EVERY draft (not just at the end): a killed/crashed batch
// must never lose the rows it already paid for. Re-reads the day file fresh
// each time so "sent" marks made from the Due page mid-batch survive.
await fs.mkdir(outDir, { recursive: true })
async function saveDayFile(results) {
  let fresh = []
  try {
    fresh = JSON.parse(await fs.readFile(jsonFile, 'utf8')).drafts ?? []
  } catch {
    /* first run today */
  }
  const mergedMap = new Map()
  for (const e of fresh) mergedMap.set(entryKey(e.contactId ?? e.name, e.step), e)
  for (const r of results) mergedMap.set(entryKey(r.contactId ?? r.name, r.step), r)
  const merged = [...mergedMap.values()]
  const tmp = jsonFile.replace(/\.json$/, '.tmp.json')
  await fs.writeFile(
    tmp,
    JSON.stringify({ date, source: path.basename(file), generated_at: new Date().toISOString(), drafts: merged }, null, 2)
  )
  await fs.rename(tmp, jsonFile)
  return merged
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
    const requestDraft = async (extraContext) => {
      const ctx = [...history.slice(-10), ...(extraContext ? [extraContext] : [])]
      const res = await fetch(`${BASE}/api/draft`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contactId: contact.id,
          kind: 'next',
          dueStep: row['Current Step'] || undefined,
          batchContext: ctx.length ? ctx.join('\n') : undefined,
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
      return done
    }

    // Token usage is summed across every call this row costs (the mechanic
    // retry below included) so server/scripts/draft-cost.js can price a day
    // honestly rather than by guesswork.
    const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
    const addUsage = (u) => {
      if (!u) return
      for (const k of Object.keys(usage)) usage[k] += u[k] ?? 0
    }
    let done = await requestDraft()
    addUsage(done.usage)
    let draft = done.draft
    // Mechanic collision → one retry with the mechanic banned by name; a
    // second collision ships flagged, never silently.
    const used = mechanicsByAccount.get(row.Account) ?? new Set()
    let mech = mechanicOf(draft.body)
    if (used.has(mech)) {
      process.stdout.write(`(opener "${mech}" already used at this account — retrying) `)
      done = await requestDraft(
        `REJECTED DRAFT NOTE: your previous attempt opened with the "${mech}" mechanic, which a colleague's draft at this account already uses — colleagues compare inboxes. Open this message a structurally different way (different move entirely, not a rewording).`
      )
      addUsage(done.usage)
      draft = done.draft
      mech = mechanicOf(draft.body)
      if (used.has(mech)) {
        draft.flag_warnings = [...(draft.flag_warnings ?? []), `opener mechanic ("${mech}") repeats a colleague's draft at this account — rewrite the opener before sending`]
      }
    }
    entry.draft = draft
    entry.usage = usage
    results.push(entry)
    rememberDraft(row.Account, entry)
    rememberMechanic(row.Account, draft.body)
    console.log(`✓ ${draft.play} (${draft.channel})${draft.flag_warnings?.length ? ` ⚑${draft.flag_warnings.length}` : ''}`)
  } catch (err) {
    entry.error = err.message
    results.push(entry)
    console.log(`✗ ${err.message}`)
  }
  await saveDayFile(results)
}

// ---------- write outputs (merge into the day file — partial re-runs keep the rest) ----------
const merged = await saveDayFile(results)

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
