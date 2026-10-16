// Outreach tracker store (activity / contacts / accounts modules).
// Single JSON file at data/tracker.json — this server is the ONLY writer
// (Groove has no API; all logging is manual one-tap from the dashboard).
// Same discipline as meta.js: fresh read-modify-write, serialized through one
// promise chain, atomic temp-file + rename. chokidar already watches data/,
// so every write broadcasts an SSE "data" event to the dashboard for free.
//
// Collections:
//   activities[]: { id, ts, type, contactId? }
//   contacts[]:   { id, name?, title?, accountId, persona, step, lastTouch,
//                   nextAction, nextDate, hook, status, watch, notes,
//                   connected }   (Module 2)
//   watch/notes power the #/activity watchlist (mini-CRM for hand-picked
//   contacts — out-of-flow moves and anything Groove doesn't hold). connected
//   (LinkedIn) flips draft.js's InMail play to a voice-note/video ask.
//   accounts[]:   { id, name, g2Slug?, sfId?, threadIds[], playType, flags[],
//                   signalSeen[] } (Module 2) — signalSeen is acknowledged
//   Day-tab signal fingerprints, see plays.js scanSignals.
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { paths } from './config.js'
import { personas } from '../../data/personas.js'

const FILE = path.join(paths.dataDir, 'tracker.json')

export const ACTIVITY_TYPES = ['call', 'email', 'linkedin', 'video', 'inmail', 'reply', 'meeting']
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

// Punctuation is collapsed to single spaces on BOTH the title and the needle
// before matching: Groove writes titles comma-style ("Vice President,
// Marketing") while personas.js lists them space-style ("VP Marketing"), so a
// raw substring test missed every comma'd VP title and left the contact with
// no persona at all.
const normalizeTitle = (s) =>
  s.toLowerCase().replace(/vice president/g, 'vp').replace(/[^a-z0-9]+/g, ' ').trim()

export function personaForTitle(title) {
  if (!title) return null
  // "Vice President, Revenue Marketing" must not hit executive's "President".
  const t = normalizeTitle(title)
  for (const key of [...PERSONA_MATCH_ORDER, ...PERSONA_KEYS.filter((k) => !PERSONA_MATCH_ORDER.includes(k))]) {
    for (const raw of personas[key].titles) {
      const needle = normalizeTitle(raw)
      if (needle.length <= 3 ? new RegExp(`\\b${needle}\\b`).test(t) : t.includes(needle)) return key
    }
  }
  return null
}

const badInput = (msg) => Object.assign(new Error(msg), { code: 'bad-input' })

const EMPTY = () => ({ activities: [], contacts: [], accounts: [] })

let chain = Promise.resolve()

export async function readStore() {
  try {
    const store = JSON.parse(await fs.readFile(FILE, 'utf8'))
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

export async function logActivity({ type, contactId }) {
  if (!ACTIVITY_TYPES.includes(type)) {
    throw badInput(`type must be one of: ${ACTIVITY_TYPES.join(', ')}`)
  }
  const activity = {
    id: randomUUID(),
    ts: new Date().toISOString(),
    type,
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
  if (patch.aeOwner !== undefined && patch.aeOwner !== null && typeof patch.aeOwner !== 'string') {
    throw badInput('aeOwner must be a string or null')
  }
  if (patch.signalSeen !== undefined && !(Array.isArray(patch.signalSeen) && patch.signalSeen.every((f) => typeof f === 'string'))) {
    throw badInput('signalSeen must be an array of strings')
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
    signalSeen: [], // acknowledged Day-tab signal fingerprints — see plays.js scanSignals
  }
  let existed = false
  await updateStore((store) => {
    if (store.accounts.some((a) => a.id === id)) existed = true // idempotent for the seed script
    else store.accounts.push(account)
  })
  return { account, existed }
}

export async function patchAccount(id, patch) {
  const allowed = ['name', 'g2Slug', 'sfId', 'playType', 'flags', 'aeOwner', 'signalSeen']
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

export async function addContact({ accountId, persona, name, title, hook, nextAction, nextDate, status, sfContactId, email, watch, notes }) {
  if (!accountId || typeof accountId !== 'string') throw badInput('accountId is required')
  const contact = {
    id: randomUUID(),
    createdAt: new Date().toISOString(), // feeds the daily prospecting-spread nudge
    name: name?.trim() || null,
    title: title?.trim() || null,
    email: email?.trim() || null,
    sfContactId: sfContactId || null, // links the row to the SF/Groove task trail
    accountId,
    persona: persona ?? null,
    step: 1,
    lastTouch: null,
    nextAction: nextAction?.trim() || null,
    nextDate: nextDate || null,
    hook: hook?.trim() || '',
    status: status ?? (name?.trim() ? 'active' : 'to-find'),
    watch: Boolean(watch),
    notes: notes?.trim() || null,
    connected: false, // LinkedIn-connected — draft.js swaps the InMail play for a voice-note/video ask
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
  const allowed = ['name', 'title', 'persona', 'step', 'hook', 'nextAction', 'nextDate', 'status', 'lastTouch', 'sfContactId', 'email', 'watch', 'notes', 'connected']
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
    if ('watch' in clean) clean.watch = Boolean(clean.watch)
    if ('connected' in clean) clean.connected = Boolean(clean.connected)
    if ('notes' in clean) clean.notes = (typeof clean.notes === 'string' && clean.notes.trim()) || null
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

// ---------- Watchlist (contact-first add) ----------
// The Activity page searches everyone Declan is actually touching — tracker
// rows AND the whole Groove mirror — so the person being watched may not
// have a tracker row (or even a tracker account) yet. Resolution mirrors
// the due-CSV script: sfContactId → name-within-account; missing contact
// rows are created with title/persona from the mirror, missing accounts get
// the research-index slug when the name matches a dossier (so hook angles
// and drafts keep working) or a slugified name otherwise.
const slugify = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

const readJson = async (file) => JSON.parse(await fs.readFile(path.join(paths.dataDir, file), 'utf8'))

export async function watchContact({ contactId, sfContactId }) {
  if (contactId) {
    const contact = await patchContact(contactId, { watch: true })
    if (!contact) throw badInput(`no tracker contact "${contactId}"`)
    return contact
  }
  if (!sfContactId) throw badInput('contactId or sfContactId is required')

  let mirror
  try {
    mirror = await readJson('outreach.json')
  } catch {
    throw badInput('no Groove mirror (data/outreach.json) — run an outreach sync first')
  }
  const m = (mirror.contacts ?? []).find((c) => c.sf_contact_id === sfContactId)
  if (!m) throw badInput(`contact ${sfContactId} is not in the Groove mirror`)

  const store = await readStore()
  const bySfId = store.contacts.find((c) => c.sfContactId === sfContactId)
  if (bySfId) return patchContact(bySfId.id, { watch: true })

  let accountId = (
    store.accounts.find((a) => a.sfId && a.sfId === m.sf_account_id) ??
    store.accounts.find((a) => m.account_name && a.name.toLowerCase() === m.account_name.toLowerCase())
  )?.id
  if (!accountId) {
    let slug = null
    try {
      const index = await readJson('index.json')
      slug = (index.accounts ?? []).find((a) => a.name?.toLowerCase() === m.account_name?.toLowerCase())?.slug ?? null
    } catch {
      /* no research index — fall through to slugified name */
    }
    accountId = slug ?? slugify(m.account_name ?? sfContactId)
    await addAccount({ id: accountId, name: m.account_name ?? accountId, sfId: m.sf_account_id ?? null })
  }

  const byName = m.name
    ? store.contacts.find((c) => c.accountId === accountId && c.name?.toLowerCase() === m.name.toLowerCase())
    : null
  if (byName) return patchContact(byName.id, { watch: true, sfContactId })

  return addContact({
    accountId,
    name: m.name,
    title: m.title,
    persona: m.title ? personaForTitle(m.title) : null,
    sfContactId,
    watch: true,
  })
}

// Everything the dashboard needs in one GET: today's raw activity rows +
// per-type counts (Groove is the system of record for activity stats — this
// is just today's tally for the quick-log bar, not a trend/goal store).
export function summarize(store) {
  const today = localDay(Date.now())
  const counts = {}
  for (const a of store.activities) {
    if (localDay(a.ts) !== today) continue
    counts[a.type] = (counts[a.type] ?? 0) + 1
  }
  // Live threads per account = named contacts actually in motion. Computed,
  // not stored, so the single-threaded warning can never go stale.
  const threadIds = new Map()
  for (const c of store.contacts) {
    if (c.name && ['active', 'replied', 'meeting'].includes(c.status)) {
      threadIds.set(c.accountId, [...(threadIds.get(c.accountId) ?? []), c.id])
    }
  }
  // Prospecting spread — the anti-"grind one account all day" nudge: the goal
  // is ~5 NEW people from ~5 DIFFERENT accounts per day, so pipeline widens
  // instead of one account absorbing the whole day. Rows without createdAt
  // predate the field and simply don't count.
  const addedToday = store.contacts.filter((c) => c.createdAt && localDay(c.createdAt) === today)
  const spread = {
    goal_people: 5,
    goal_accounts: 5,
    people: addedToday.length,
    accounts: new Set(addedToday.map((c) => c.accountId)).size,
  }

  return {
    types: ACTIVITY_TYPES,
    personas,
    play_types: PLAY_TYPES,
    contact_statuses: CONTACT_STATUSES,
    accounts: store.accounts.map((a) => ({ ...a, threadIds: threadIds.get(a.id) ?? [] })),
    contacts: store.contacts,
    today: {
      date: today,
      activities: store.activities.filter((a) => localDay(a.ts) === today),
      counts,
      spread,
    },
  }
}
