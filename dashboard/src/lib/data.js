// All dashboard data comes from static JSON under /data — never MCPs.

async function fetchJson(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  return res.json()
}

export function fetchIndex() {
  return fetchJson('/data/index.json')
}

export function fetchAccount(slug) {
  return fetchJson(`/data/accounts/${slug}.json`)
}

export function fetchMeta() {
  return fetchJson('/data/meta.json')
}

// ---- Phase 3 server API (queue status, refresh, live events) ----

export function fetchStatus() {
  return fetchJson('/api/status')
}

export async function requestRefresh(query, mode) {
  const res = await fetch('/api/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, mode }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.error ?? `refresh failed: HTTP ${res.status}`)
  return body
}

// Live updates over SSE. Returns an unsubscribe function. If the server
// isn't running (plain `vite dev`), EventSource just retries quietly and
// the dashboard stays read-only.
export function subscribeEvents({ onData, onJob }) {
  const es = new EventSource('/api/events')
  es.addEventListener('data', (e) => onData?.(JSON.parse(e.data)))
  es.addEventListener('job', (e) => onJob?.(JSON.parse(e.data)))
  return () => es.close()
}
