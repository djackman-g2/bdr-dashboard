// Outreach tracker API + shared math. All state lives in data/tracker.json on
// the server; every mutation returns the full refreshed summary.

async function api(url, options) {
  const res = await fetch(url, options)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `${url}: HTTP ${res.status}`)
  return body
}

export function fetchTracker() {
  return api('/api/tracker')
}

export function logActivity(payload) {
  return api('/api/tracker/activity', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export function undoActivity(id) {
  return api(`/api/tracker/activity/${id}`, { method: 'DELETE' })
}

// ---- Module 2: accounts & contacts working layer ----

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const addTrackerAccount = (account) => api('/api/tracker/accounts', json('POST', account))
export const patchTrackerAccount = (id, patch) => api(`/api/tracker/accounts/${id}`, json('PATCH', patch))
export const deleteTrackerAccount = (id) => api(`/api/tracker/accounts/${id}`, { method: 'DELETE' })
export const addTrackerContact = (contact) => api('/api/tracker/contacts', json('POST', contact))
// Send desk: server-side draft (enrollment pack / next-step message) for a
// contact — grounded on dossier + plays + Groove touch history. ~30-60s.
export const requestDraft = (contactId, kind) => api('/api/draft', json('POST', { contactId, kind }))
export const patchTrackerContact = (id, patch) => api(`/api/tracker/contacts/${id}`, json('PATCH', patch))
export const deleteTrackerContact = (id) => api(`/api/tracker/contacts/${id}`, { method: 'DELETE' })

// Client-side persona guess (import buttons) — mirrors the server's matcher:
// specific personas before `marketing` (its titles include "Product
// Marketing"), short tokens whole-word only ("GM" must not match "segment").
const PERSONA_MATCH_ORDER = ['demandGenSpecific', 'productMarketing', 'customerSuccess', 'productManagement', 'sales', 'executive', 'marketing']

export function personaForTitle(title, personas) {
  if (!title || !personas) return null
  // "Vice President, Revenue Marketing" must not hit executive's "President".
  const t = title.toLowerCase().replace(/vice president/g, 'vp')
  const keys = [...PERSONA_MATCH_ORDER.filter((k) => personas[k]), ...Object.keys(personas).filter((k) => !PERSONA_MATCH_ORDER.includes(k))]
  for (const key of keys) {
    for (const raw of personas[key].titles) {
      const needle = raw.toLowerCase()
      if (needle.length <= 3 ? new RegExp(`\\b${needle}\\b`).test(t) : t.includes(needle)) return key
    }
  }
  return null
}

// "demandGenSpecific" → "demand gen specific" for selects and chips.
export const personaLabel = (key) => (key ? key.replace(/([A-Z])/g, ' $1').toLowerCase() : '—')

export const TYPE_LABELS = {
  call: 'Calls',
  email: 'Emails',
  linkedin: 'LinkedIn',
  video: 'Videos',
  inmail: 'InMails',
  reply: 'Replies',
  meeting: 'Meetings',
}

export const OUTCOME_LABELS = { connect: 'Connect', vm: 'VM', 'no-answer': 'No answer', gatekeeper: 'Gatekeeper' }

// Three-state goal read: below floor → pushing, at/above floor → good,
// at/above stretch → great. A 55 must read as "above floor", never "missed 60".
export function goalState(count, goal) {
  if (!goal) return null
  if (goal.stretch && count >= goal.stretch) return 'stretch'
  if (goal.floor && count >= goal.floor) return 'floor'
  if (!goal.floor && goal.stretch && count >= goal.stretch) return 'stretch'
  return 'below'
}

// Required-per-hour to hit a target by 5pm — the afternoon-driving number.
export function pace(count, target, now = new Date()) {
  if (!target) return null
  const end = new Date(now)
  end.setHours(17, 0, 0, 0)
  const hoursLeft = (end - now) / 3.6e6
  const need = Math.max(target - count, 0)
  if (need === 0) return { need: 0, hoursLeft, perHour: 0 }
  if (hoursLeft <= 0) return { need, hoursLeft: 0, perHour: null } // past 5pm, still short
  return { need, hoursLeft, perHour: need / hoursLeft }
}

export function connectRate(today) {
  if (!today?.outcome_calls) return null
  return today.connects / today.outcome_calls
}
