// Groove API client — reverse-engineered internal REST API, NOT an official
// integration. See CLAUDE.md "Groove CLI / Playwright constraints" for the
// full rationale and guardrails; this file implements them.
//
// Auth: session cookies are harvested from the dedicated Groove Playwright
// profile (server/scripts/groove-login.js), cached briefly, and attached to
// plain fetch() calls — no Playwright launch in the hot path. Endpoint shapes
// come ONLY from config.groove.endpoint_map (data/groove/endpoint-map.json),
// a hand-curated artifact produced by server/scripts/groove-capture.js.
// Nothing here guesses a path — a missing map entry is a hard error telling
// the human to run the capture step, never a fallback guess.
//
// Fail loud, never silently retry: any non-2xx, any response whose shape
// doesn't match what the map recorded, or an HTML/login page instead of JSON
// throws immediately. A botched retry against a since-changed endpoint could
// double-log a call or mis-advance a real flow step — this is consequential
// state in a live tool, not a best-effort research lookup.
import { chromium } from 'playwright-core'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config, paths } from './config.js'

const cfg = config.groove
const BASE_URL = cfg.base_url.replace(/\/+$/, '')
// The SPA is served from groove.clari.com but every /api/v2 call in the
// capture goes to engine.groove.clari.com — a different host, sent with the
// SPA's own Origin/Referer. Hitting BASE_URL with an /api path returns the
// app shell (HTML), which surfaces as the "returned non-JSON" error rather
// than anything that names the real cause. 2026-08-18.
const API_BASE_URL = (cfg.api_base_url ?? cfg.base_url).replace(/\/+$/, '')
const GROOVE_DIR = path.join(paths.dataDir, 'groove')
const SESSION_CACHE = path.join(paths.root, cfg.session_cache)
const WRITE_LOG = path.join(GROOVE_DIR, 'write-log.json')
const ENDPOINT_MAP = path.join(paths.root, cfg.endpoint_map)

const err = (message) => Object.assign(new Error(message), { code: 'groove' })

// ---------- endpoint map ----------

let mapCache = null
async function getMap() {
  if (mapCache) return mapCache
  let raw
  try {
    raw = await fs.readFile(ENDPOINT_MAP, 'utf8')
  } catch {
    throw err(
      `no endpoint map at ${ENDPOINT_MAP} — run \`npm run groove:capture\`, exercise the actions you need, then hand-curate the raw capture into this file before calling the Groove CLI.`
    )
  }
  mapCache = JSON.parse(raw)
  return mapCache
}

function getAction(map, action) {
  const entry = map[action]
  if (!entry) {
    throw err(`no "${action}" entry in ${cfg.endpoint_map} — capture that action with groove-capture.js and add it to the map.`)
  }
  return entry
}

function fillTemplate(template, params) {
  return template.replace(/\{(\w+)\}/g, (_, key) => {
    if (params[key] === undefined) throw err(`endpoint template "${template}" needs param "${key}"`)
    return encodeURIComponent(params[key])
  })
}

// ---------- session ----------

let sessionCache = null

async function harvestSession() {
  const ctx = await chromium.launchPersistentContext(cfg.profile_dir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
  })
  try {
    const page = ctx.pages()[0] ?? (await ctx.newPage())
    await page.goto(cfg.base_url, { waitUntil: 'domcontentloaded', timeout: 45000 })
    if (/sign_?in|\/login|\/auth|checkpoint/i.test(page.url())) {
      throw err('Groove session is dead (redirected to login) — run `npm run groove:login` and log in by hand.')
    }
    // The URL check alone is NOT enough — Groove serves its login page from
    // the host root with no path marker, so a dead session sails past the
    // regex and we cache cookies that 401 on the first real call (seen
    // 2026-08-25: harvest "succeeded", flows-list came back 401 with an
    // opaque NotAuthenticatedError). groove-session-check.js already learned
    // this on 2026-08-18; the same probe belongs here, because this is the
    // path every unattended run takes. Fail here, naming the fix, rather than
    // handing dead cookies to the caller.
    const probe = await page
      .evaluate(async (base) => {
        const r = await fetch(`${base}/api/v2/user`, { credentials: 'include', headers: { Accept: 'application/json' } })
        return r.status
      }, API_BASE_URL.replace(/\/+$/, ''))
      .catch(() => null)
    if (probe !== 200) {
      throw err(
        `Groove session is dead (GET /api/v2/user → ${probe ?? 'failed'}) — run \`npm run groove:login\`, log in by hand, then Cmd+Q the window.`
      )
    }
    // Cookies for BOTH hosts: the session rides groove.clari.com, but the
    // calls go to engine.groove.clari.com and host-scoped cookies on either
    // side would otherwise be dropped. Dedupe by name, engine last.
    const cookies = [...(await ctx.cookies(cfg.base_url)), ...(await ctx.cookies(API_BASE_URL))]
    if (!cookies.length) throw err('no cookies found for the Groove profile — run `npm run groove:login`.')
    const byName = new Map(cookies.map((c) => [c.name, c.value]))
    // Best-effort: reads are GETs and don't need CSRF, but writes will. If the
    // SPA stops exposing it here, a write fails loud rather than silently
    // sending an unauthenticated mutation.
    const csrfToken =
      [...byName].find(([name]) => /csrf|xsrf/i.test(name))?.[1] ??
      (await page.evaluate(() => {
        const meta = document.querySelector('meta[name="csrf-token"]')?.content
        if (meta) return meta
        for (const k of Object.keys(window.localStorage)) {
          if (/csrf|xsrf/i.test(k)) return window.localStorage.getItem(k)
        }
        return null
      }).catch(() => null))
    const session = {
      obtained_at: new Date().toISOString(),
      cookie: [...byName].map(([name, value]) => `${name}=${value}`).join('; '),
      csrfToken: csrfToken ? decodeURIComponent(csrfToken) : null,
    }
    await fs.mkdir(path.dirname(SESSION_CACHE), { recursive: true })
    const tmp = `${SESSION_CACHE}.tmp.json`
    await fs.writeFile(tmp, JSON.stringify(session, null, 2) + '\n')
    await fs.rename(tmp, SESSION_CACHE)
    return session
  } finally {
    await ctx.close()
  }
}

async function getSession({ forceRefresh = false } = {}) {
  if (!forceRefresh) {
    if (sessionCache) return sessionCache
    try {
      const cached = JSON.parse(await fs.readFile(SESSION_CACHE, 'utf8'))
      const ageMinutes = (Date.now() - new Date(cached.obtained_at).getTime()) / 60000
      if (ageMinutes < cfg.session_ttl_minutes) {
        sessionCache = cached
        return cached
      }
    } catch {
      /* no cache yet — harvest below */
    }
  }
  sessionCache = await harvestSession()
  return sessionCache
}

export function invalidateSession() {
  sessionCache = null
}

// ---------- rate limiting (writes only) ----------

let writesThisRun = 0

async function readWriteLog() {
  try {
    return JSON.parse(await fs.readFile(WRITE_LOG, 'utf8'))
  } catch {
    return {}
  }
}

async function checkAndRecordWrite() {
  writesThisRun += 1
  if (writesThisRun > cfg.max_writes_per_run) {
    throw err(`max_writes_per_run (${cfg.max_writes_per_run}) exceeded for this run — this is a deliberate guardrail, not a bug. Raise config.groove.max_writes_per_run if you're confident, or run again later.`)
  }
  const today = new Date().toLocaleDateString('en-CA')
  const log = await readWriteLog()
  const countToday = (log[today] ?? 0) + 1
  if (countToday > cfg.max_writes_per_day) {
    throw err(`max_writes_per_day (${cfg.max_writes_per_day}) exceeded — this is a deliberate guardrail against unverified Groove rate limits. Raise config.groove.max_writes_per_day if you're confident, or wait until tomorrow.`)
  }
  log[today] = countToday
  await fs.mkdir(GROOVE_DIR, { recursive: true })
  const tmp = `${WRITE_LOG}.tmp.json`
  await fs.writeFile(tmp, JSON.stringify(log, null, 2) + '\n')
  await fs.rename(tmp, WRITE_LOG)
}

let lastWriteAt = 0
async function pace() {
  const waitMs = cfg.min_seconds_between_writes * 1000 - (Date.now() - lastWriteAt)
  if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs))
  lastWriteAt = Date.now()
}

// ---------- dispatcher ----------

const isWrite = (method) => method !== 'GET'

// dryRun: print what would be sent, never call fetch or count against limits.
export async function grooveFetch(action, params = {}, { dryRun = false } = {}) {
  const map = await getMap()
  const entry = getAction(map, action)
  const url = `${API_BASE_URL}${fillTemplate(entry.urlTemplate, params)}`
  // bodyFields: array of param names to pull straight into the JSON body,
  // e.g. ["disposition", "note"] -> {"disposition": params.disposition, "note": params.note}.
  const body = entry.bodyFields
    ? JSON.stringify(Object.fromEntries(entry.bodyFields.map((k) => [k, params[k]])))
    : undefined

  if (dryRun) {
    console.log(`[dry-run] ${entry.method} ${url}${body ? `\n  body: ${body}` : ''}`)
    return { dryRun: true, method: entry.method, url, body }
  }

  if (isWrite(entry.method)) {
    await pace()
    await checkAndRecordWrite()
  }

  const session = await getSession()
  const doFetch = async (sess) =>
    fetch(url, {
      method: entry.method,
      headers: {
        Cookie: sess.cookie,
        // The engine host checks these on cross-subdomain calls; the browser
        // sends them on every request the capture recorded.
        Accept: 'application/json',
        Origin: BASE_URL,
        Referer: `${BASE_URL}/`,
        ...(sess.csrfToken ? { 'X-CSRF-Token': sess.csrfToken } : {}),
        ...(entry.requiredHeaders ?? {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body,
    })

  let resp = await doFetch(session)
  if (resp.status === 401 || resp.status === 403) {
    invalidateSession()
    const fresh = await getSession({ forceRefresh: true })
    resp = await doFetch(fresh)
  }

  const text = await resp.text()
  const looksLikeLogin = /sign_?in|<form[^>]*login/i.test(text.slice(0, 2000))
  if (looksLikeLogin) {
    throw err(`Groove returned a login page for action "${action}" — session is dead. Run \`npm run groove:login\`.`)
  }
  if (!resp.ok) {
    throw err(`Groove action "${action}" failed: HTTP ${resp.status} — ${text.slice(0, 300)}`)
  }
  let json
  try {
    json = JSON.parse(text)
  } catch {
    throw err(`Groove action "${action}" returned non-JSON — Groove's UI/API likely changed. Re-run groove-capture.js and update the endpoint map. Raw: ${text.slice(0, 300)}`)
  }
  return json
}

// ---------- actions ----------

export const listFlows = () => grooveFetch('flows-list')
export const getFlow = (flowId) => grooveFetch('flow-show', { flowId })
export const getSteps = (flowId, { withTemplates = false } = {}) =>
  grooveFetch(withTemplates ? 'steps-list-full' : 'steps-list', { flowId })

// One page. Callers wanting the whole list use getAllDueContacts.
export const getDueContacts = ({ flowId, filter = 'due_today', page = 1, perPage = 100 } = {}) =>
  grooveFetch('due-list', { flowId, filter, page, perPage })

// Pages until the accumulated count reaches meta.total_count. A long due list
// is exactly the case the single hardcoded page=1 call used to truncate
// silently at 100 — never cap without saying so.
export async function getAllDueContacts({ flowId, filter = 'due_today', perPage = 100 } = {}) {
  const rows = []
  let total = null
  for (let page = 1; ; page++) {
    const resp = await getDueContacts({ flowId, filter, page, perPage })
    const batch = resp?.data
    if (!Array.isArray(batch)) {
      throw err(`due-list for flow ${flowId} returned no "data" array — Groove's API shape changed; re-run \`npm run groove:capture\`.`)
    }
    if (total === null) total = resp.meta?.total_count ?? batch.length
    rows.push(...batch)
    if (batch.length === 0 || rows.length >= total) break
    if (page > 50) throw err(`due-list for flow ${flowId} exceeded 50 pages — refusing to loop further.`)
  }
  return { rows, total }
}
export const getContact = (idOrEmail) => grooveFetch('contact-show', { contactId: idOrEmail })
export const logCall = (contactId, { disposition, note } = {}, opts) =>
  grooveFetch('log-call', { contactId, disposition, note: note ?? '' }, opts)
export const logEmail = (contactId, { subject, body } = {}, opts) =>
  grooveFetch('log-email', { contactId, subject, body }, opts)
export const advanceStep = (contactId, opts) => grooveFetch('advance-step', { contactId }, opts)
export const enrollContact = (contactId, flowId, opts) => grooveFetch('enroll', { contactId, flowId }, opts)
export const removeContact = (contactId, flowId, opts) => grooveFetch('remove', { contactId, flowId }, opts)

export async function bulkEnroll(flowId, contactIds, opts) {
  const results = []
  for (const contactId of contactIds) {
    try {
      results.push({ contactId, ok: true, result: await enrollContact(contactId, flowId, opts) })
    } catch (e) {
      results.push({ contactId, ok: false, error: e.message })
      break // stop the whole batch on first failure — never skip-and-continue silently
    }
  }
  return results
}

export async function bulkRemove(flowId, contactIds, opts) {
  const results = []
  for (const contactId of contactIds) {
    try {
      results.push({ contactId, ok: true, result: await removeContact(contactId, flowId, opts) })
    } catch (e) {
      results.push({ contactId, ok: false, error: e.message })
      break
    }
  }
  return results
}
