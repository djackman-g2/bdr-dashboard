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
