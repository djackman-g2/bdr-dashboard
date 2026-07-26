// Outreach tracker store (activity / contacts / accounts modules).
// Single JSON file at data/tracker.json — this server is the ONLY writer
// (Groove has no API; all logging is manual one-tap from the dashboard).
// Same discipline as meta.js: fresh read-modify-write, serialized through one
// promise chain, atomic temp-file + rename. chokidar already watches data/,
// so every write broadcasts an SSE "data" event to the dashboard for free.
//
// Collections:
//   activities[]: { id, ts, type, contactId?, outcome? }
//   contacts[]:   { id, name?, title?, accountId, persona, step, lastTouch,
//                   nextAction, nextDate, hook, status }   (Module 2)
//   accounts[]:   { id, name, g2Slug?, sfId?, threadIds[], playType, flags[] } (Module 2)
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { paths } from './config.js'
import { personas } from '../../data/personas.js'

const FILE = path.join(paths.dataDir, 'tracker.json')

export const ACTIVITY_TYPES = ['call', 'email', 'linkedin', 'video', 'inmail', 'reply', 'meeting']
export const CALL_OUTCOMES = ['connect', 'vm', 'no-answer', 'gatekeeper']
export const PLAY_TYPES = ['AEO', 'buyer-intent', 'winback', 'top-down']
export const CONTACT_STATUSES = ['to-find', 'active', 'replied', 'meeting', 'dead']
export const PERSONA_KEYS = Object.keys(personas)

// Persona guess from a job title. Most-specific personas first — plain config
// order would send every PMM to `marketing` (whose titles include "Product
// Marketing"). Tokens of ≤3 chars match whole words only, otherwise "GM"
// would match "segment".
const PERSONA_MATCH_ORDER = [
  'demandGenSpecific',
  'productMarketing',
  'customerSuccess',
  'productManagement',
  'sales',
  'executive',
  'marketing',
].filter((k) => PERSONA_KEYS.includes(k))

export function personaForTitle(title) {
  if (!title) return null
  // "Vice President, Revenue Marketing" must not hit executive's "President".
  const t = title.toLowerCase().replace(/vice president/g, 'vp')
  for (const key of [...PERSONA_MATCH_ORDER, ...PERSONA_KEYS.filter((k) => !PERSONA_MATCH_ORDER.includes(k))]) {
    for (const raw of personas[key].titles) {
      const needle = raw.toLowerCase()
      if (needle.length <= 3 ? new RegExp(`\\b${needle}\\b`).test(t) : t.includes(needle)) return key
    }
  }
  return null
}

const badInput = (msg) => Object.assign(new Error(msg), { code: 'bad-input' })

// Daily goals. calls/emails have a floor (the real bar) and a stretch —
// a 55 reads as "above floor", never "missed stretch". Others are stretch-only.
// Seeded into tracker.json on first run; edit the file to change them.
const DEFAULT_GOALS = {
  call: { floor: 50, stretch: 60 },
  email: { floor: 50, stretch: 60 },
  linkedin: { stretch: 10 },
  video: { stretch: 5 },
  inmail: { stretch: 5 },
}

const EMPTY = () => ({ goals: DEFAULT_GOALS, activities: [], contacts: [], accounts: [] })

let chain = Promise.resolve()

export async function readStore() {
  try {
    const store = JSON.parse(await fs.readFile(FILE, 'utf8'))
    store.goals ??= DEFAULT_GOALS
    store.activities ??= []
    store.contacts ??= []
    store.accounts ??= []
    return store
  } catch (err) {
    if (err.code === 'ENOENT') return EMPTY()
    throw err
  }
}

// mutate(store) edits in place or returns a replacement. Returns final store.
export function updateStore(mutate) {
  const run = async () => {
    const store = await readStore()
    const next = (await mutate(store)) ?? store
    const tmp = FILE + '.tmp'
    await fs.writeFile(tmp, JSON.stringify(next, null, 2) + '\n')
    await fs.rename(tmp, FILE)
    return next
  }
  const result = chain.then(run, run)
  chain = result.catch(() => {})
  return result
}

// Local calendar day (YYYY-MM-DD) — counts reset at local midnight, history
// keeps every activity row so trends stay recomputable.
export const localDay = (ts) => new Date(ts).toLocaleDateString('en-CA')

export async function logActivity({ type, outcome, contactId }) {
  if (!ACTIVITY_TYPES.includes(type)) {
    throw badInput(`type must be one of: ${ACTIVITY_TYPES.join(', ')}`)
  }
  if (outcome !== undefined && (type !== 'call' || !CALL_OUTCOMES.includes(outcome))) {
    throw badInput(`outcome is calls-only, one of: ${CALL_OUTCOMES.join(', ')}`)
  }
  const activity = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type,
    ...(outcome ? { outcome } : {}),
    ...(contactId ? { contactId } : {}),
  }
  await updateStore((store) => {
    store.activities.push(activity)
    // Long-press attach (wired after Module 2): touching a contact advances it.
    if (contactId) {
      const c = store.contacts.find((c) => c.id === contactId)
      if (c) {
        c.lastTouch = activity.ts
        if (typeof c.step === 'number' && c.step < 6 && c.hook) c.step += 1 // no hook, no advance
      }
    }
  })
  return activity
}

export async function undoActivity(id) {
  let removed = null
  await updateStore((store) => {
    const i = store.activities.findIndex((a) => a.id === id)
    if (i >= 0) removed = store.activities.splice(i, 1)[0]
  })
  return removed
}

// ---------- Accounts (Module 2 — thin working layer, SF stays SoR) ----------
// id = the research index slug, which links each tracker account to its
// dossier. threadIds is NOT stored — it's derived from contacts at read time
// (see summarize), so it can never drift from the contact rows.

function validateAccountPatch(patch) {
  if (patch.playType != null && !PLAY_TYPES.includes(patch.playType)) {
    throw badInput(`playType must be null or one of: ${PLAY_TYPES.join(', ')}`)
  }
  if (patch.flags !== undefined && !(Array.isArray(patch.flags) && patch.flags.every((f) => typeof f === 'string'))) {
    throw badInput('flags must be an array of strings')
  }
}

export async function addAccount({ id, name, sfId, g2Slug, playType, flags }) {
  if (!id || typeof id !== 'string' || typeof name !== 'string' || !name.trim()) {
    throw badInput('id (account slug) and name are required')
  }
  validateAccountPatch({ playType, flags })
  const account = {
    id,
    name: name.trim(),
    g2Slug: g2Slug ?? null,
    sfId: sfId ?? null,
    playType: playType ?? null,
    flags: flags ?? [],
  }
  let existed = false
  await updateStore((store) => {
    if (store.accounts.some((a) => a.id === id)) existed = true // idempotent for the seed script
    else store.accounts.push(account)
  })
  return { account, existed }
}

export async function patchAccount(id, patch) {
  const allowed = ['name', 'g2Slug', 'sfId', 'playType', 'flags']
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)))
  validateAccountPatch(clean)
  if (clean.name !== undefined && (typeof clean.name !== 'string' || !clean.name.trim())) {
    throw badInput('name cannot be emptied')
  }
  let account = null
  await updateStore((store) => {
    account = store.accounts.find((a) => a.id === id)
    if (account) Object.assign(account, clean)
  })
  return account
}

// Removes the account AND its contact rows — this is a working layer, the
// research dossier and SF record are untouched.
export async function removeAccount(id) {
  let removed = null
  await updateStore((store) => {
    const i = store.accounts.findIndex((a) => a.id === id)
    if (i < 0) return
    removed = store.accounts.splice(i, 1)[0]
    store.contacts = store.contacts.filter((c) => c.accountId !== id)
  })
  return removed
}

// ---------- Contacts ----------
// A row can exist as just {accountId, persona, status:'to-find'} — no name.
// The daily research block fills names in later; persona is assigned the
// moment the role is known, and the hook writes itself from
// personas[persona].hookAngle + the account's pulled proof.

function validateContactFields(patch, { forStep, forHook }) {
  if (patch.persona !== undefined && patch.persona !== null && !PERSONA_KEYS.includes(patch.persona)) {
    throw badInput(`persona must be null or one of: ${PERSONA_KEYS.join(', ')}`)
  }
  if (patch.status !== undefined && !CONTACT_STATUSES.includes(patch.status)) {
    throw badInput(`status must be one of: ${CONTACT_STATUSES.join(', ')}`)
  }
  if (patch.step !== undefined && !(Number.isInteger(patch.step) && patch.step >= 1 && patch.step <= 6)) {
    throw badInput('step must be an integer 1-6')
  }
  // The core rule: no hook, no advance past step 1.
  if (forStep > 1 && !(forHook ?? '').trim()) {
    throw badInput('no hook, no advance past step 1 — write the hook first')
  }
}

export async function addContact({ accountId, persona, name, title, hook, nextAction, nextDate, status }) {
  if (!accountId || typeof accountId !== 'string') throw badInput('accountId is required')
  const contact = {
    id: randomUUID(),
    name: name?.trim() || null,
    title: title?.trim() || null,
    accountId,
    persona: persona ?? null,
    step: 1,
    lastTouch: null,
    nextAction: nextAction?.trim() || null,
    nextDate: nextDate || null,
    hook: hook?.trim() || '',
    status: status ?? (name?.trim() ? 'active' : 'to-find'),
  }
  validateContactFields(contact, { forStep: contact.step, forHook: contact.hook })
  await updateStore((store) => {
    if (!store.accounts.some((a) => a.id === accountId)) {
      throw badInput(`unknown accountId "${accountId}" — add the account first`)
    }
    store.contacts.push(contact)
  })
  return contact
}

export async function patchContact(id, patch) {
  const allowed = ['name', 'title', 'persona', 'step', 'hook', 'nextAction', 'nextDate', 'status', 'lastTouch']
  const clean = Object.fromEntries(Object.entries(patch ?? {}).filter(([k]) => allowed.includes(k)))
  let contact = null
  await updateStore((store) => {
    contact = store.contacts.find((c) => c.id === id)
    if (!contact) return
    validateContactFields(clean, {
      forStep: clean.step ?? contact.step,
      forHook: 'hook' in clean ? clean.hook : contact.hook,
    })
    // Naming a to-find row makes it a live target unless the patch says otherwise.
    if (clean.name && contact.status === 'to-find' && clean.status === undefined) clean.status = 'active'
    Object.assign(contact, clean)
    if (contact.hook == null) contact.hook = ''
  })
  return contact
}

export async function removeContact(id) {
  let removed = null
  await updateStore((store) => {
    const i = store.contacts.findIndex((c) => c.id === id)
    if (i >= 0) removed = store.contacts.splice(i, 1)[0]
  })
  return removed
}

// Everything the dashboard needs in one GET: goals + today's raw rows (small —
// pace/connect-rate math stays client-side where "now" lives) + per-day
// aggregates for the trend view.
export function summarize(store, days = 14) {
  const today = localDay(Date.now())
  const byDay = new Map()
  for (const a of store.activities) {
    const day = localDay(a.ts)
    let d = byDay.get(day)
    if (!d) byDay.set(day, (d = { date: day, counts: {}, outcome_calls: 0, connects: 0 }))
    d.counts[a.type] = (d.counts[a.type] ?? 0) + 1
    if (a.type === 'call' && a.outcome) {
      d.outcome_calls += 1
      if (a.outcome === 'connect') d.connects += 1
    }
  }
  const history = [...byDay.values()]
    .filter((d) => d.date !== today)
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, days)
  // Live threads per account = named contacts actually in motion. Computed,
  // not stored, so the single-threaded warning can never go stale.
  const threadIds = new Map()
  for (const c of store.contacts) {
    if (c.name && ['active', 'replied', 'meeting'].includes(c.status)) {
      threadIds.set(c.accountId, [...(threadIds.get(c.accountId) ?? []), c.id])
    }
  }
  return {
    goals: store.goals,
    types: ACTIVITY_TYPES,
    outcomes: CALL_OUTCOMES,
    personas,
    play_types: PLAY_TYPES,
    contact_statuses: CONTACT_STATUSES,
    accounts: store.accounts.map((a) => ({ ...a, threadIds: threadIds.get(a.id) ?? [] })),
    contacts: store.contacts,
    today: {
      date: today,
      activities: store.activities.filter((a) => localDay(a.ts) === today),
      ...(byDay.get(today) ?? { counts: {}, outcome_calls: 0, connects: 0 }),
    },
    history,
  }
}
