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

const FILE = path.join(paths.dataDir, 'tracker.json')

export const ACTIVITY_TYPES = ['call', 'email', 'linkedin', 'video', 'inmail', 'reply', 'meeting']
export const CALL_OUTCOMES = ['connect', 'vm', 'no-answer', 'gatekeeper']

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
    throw Object.assign(new Error(`type must be one of: ${ACTIVITY_TYPES.join(', ')}`), { code: 'bad-input' })
  }
  if (outcome !== undefined && (type !== 'call' || !CALL_OUTCOMES.includes(outcome))) {
    throw Object.assign(new Error(`outcome is calls-only, one of: ${CALL_OUTCOMES.join(', ')}`), { code: 'bad-input' })
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
  return {
    goals: store.goals,
    types: ACTIVITY_TYPES,
    outcomes: CALL_OUTCOMES,
    today: {
      date: today,
      activities: store.activities.filter((a) => localDay(a.ts) === today),
      ...(byDay.get(today) ?? { counts: {}, outcome_calls: 0, connects: 0 }),
    },
    history,
  }
}
