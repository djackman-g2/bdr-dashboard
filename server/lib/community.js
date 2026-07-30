// Community/UGC module — real user threads about the account (Reddit official
// API + Hacker News Algolia) that feed LLM buyer journeys. Raw material for
// the ugc-narrative play: the system FINDS threads, a human reads them before
// any send (guardrail lives in the play, surfaced by the dashboard card).
//
// Server-side like aiVisibility.js — no MCPs, no headless spawn, not part of
// the pipeline. Two free HTTP sources + one cheap LLM classification pass
// through the shared chat client (is this thread about THIS company, is it
// product feedback, sentiment) — plain string match false-positives on
// generic names ("Button", "You"), same lesson as ai_visibility.
//
// Reddit auth (no scraping — the public .json endpoints 403 non-browser
// clients): official API, client-credentials OAuth. Credentials live ONLY in
// the macOS Keychain as one entry, password "client_id:client_secret":
//   security add-generic-password -U -a "$USER" -s bdr-dashboard-reddit -w "<client_id>:<client_secret>"
// Missing entry → Reddit is skipped and recorded in sources_checked, HN still
// runs; the module never fails just because Reddit isn't set up yet.
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { config, paths } from './config.js'
import { getClient, invalidateClient, CHAT_MODEL } from './chat.js'
import { subjectVariants, subjectDisplayName, isWeakName } from './aiVisibility.js'

const cfg = config.community ?? {}
const KEYCHAIN_SERVICE = cfg.keychain_service ?? 'bdr-dashboard-reddit'
const WINDOW_DAYS = cfg.window_days ?? 365
const MAX_THREADS = cfg.max_threads ?? 12
const MODEL = cfg.model ?? CHAT_MODEL
const CLASSIFY_MAX_TOKENS = cfg.classify_max_tokens ?? 1500
const USER_AGENT = 'macos:bdr-dashboard:1.0 (personal research tool)'
const FETCH_TIMEOUT_MS = 20_000
const LLM_TIMEOUT_MS = 90_000

const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const err = (code, message) => Object.assign(new Error(message), { code })

let compiledValidator = null
async function getValidator() {
  if (!compiledValidator) {
    const schema = JSON.parse(await fs.readFile(path.join(paths.root, config.paths.schema), 'utf8'))
    const ajv = new Ajv({ strict: false, allErrors: true })
    addFormats(ajv)
    compiledValidator = ajv.compile(schema)
  }
  return compiledValidator
}

function accountFile(slug) {
  const file = path.join(paths.accountsDir, `${slug}.json`)
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  return file
}

function readRedditCreds() {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], (e, stdout) => {
      if (e) return resolve(null)
      const [id, secret] = stdout.trim().split(':')
      resolve(id && secret ? { id, secret } : null)
    })
  })
}

async function fetchJson(url, options = {}) {
  const resp = await fetch(url, {
    ...options,
    headers: { 'User-Agent': USER_AGENT, ...(options.headers ?? {}) },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${new URL(url).hostname}`)
  return resp.json()
}

// ---------- sources ----------

const cutoffTs = () => Math.floor(Date.now() / 1000) - WINDOW_DAYS * 86400

// Reddit official API: client-credentials token, then /search. Two anchored
// queries — exact-phrase name (skipped for weak/generic names) and url:domain.
async function searchReddit(account, creds) {
  const tokenResp = await fetch('https://www.reddit.com/api/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${creds.id}:${creds.secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': USER_AGENT,
    },
    body: 'grant_type=client_credentials',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  })
  if (!tokenResp.ok) throw new Error(`Reddit token request failed: HTTP ${tokenResp.status} (check the Keychain client_id:client_secret)`)
  const token = (await tokenResp.json()).access_token
  if (!token) throw new Error('Reddit token response had no access_token')

  const name = subjectDisplayName(account)
  const queries = []
  if (name && !isWeakName(name)) queries.push(`"${name}"`)
  if (account.domain) queries.push(`url:${account.domain}`)

  const seen = new Map()
  for (const q of queries) {
    const data = await fetchJson(
      `https://oauth.reddit.com/search?q=${encodeURIComponent(q)}&sort=new&limit=25&type=link&restrict_sr=false`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    for (const child of data?.data?.children ?? []) {
      const p = child.data
      if (!p?.permalink || p.created_utc < cutoffTs()) continue
      seen.set(p.permalink, {
        source: 'reddit',
        title: p.title ?? '(untitled)',
        url: `https://www.reddit.com${p.permalink}`,
        created: new Date(p.created_utc * 1000).toISOString().slice(0, 10),
        subreddit: p.subreddit ? `r/${p.subreddit}` : null,
        score: p.score ?? null,
        comments: p.num_comments ?? null,
        snippet: (p.selftext || '').slice(0, 300) || null,
      })
    }
  }
  return [...seen.values()]
}

// Hacker News via Algolia — free, no auth. Name query (skipped when weak)
// plus domain query; stories only, window-bounded server-side.
async function searchHackerNews(account) {
  const name = subjectDisplayName(account)
  const queries = []
  if (name && !isWeakName(name)) queries.push(name)
  if (account.domain) queries.push(account.domain)

  const seen = new Map()
  for (const q of queries) {
    // typoTolerance=false: without it Algolia fuzzy-matches company names into
    // noise ("Cresta" → every "crystal" thread) and drowns real hits.
    const data = await fetchJson(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&tags=story&hitsPerPage=15&typoTolerance=false&numericFilters=created_at_i>${cutoffTs()}`
    )
    for (const h of data?.hits ?? []) {
      if (!h.objectID) continue
      seen.set(h.objectID, {
        source: 'hackernews',
        title: h.title ?? '(untitled)',
        url: `https://news.ycombinator.com/item?id=${h.objectID}`,
        created: h.created_at?.slice(0, 10) ?? null,
        subreddit: null,
        score: h.points ?? null,
        comments: h.num_comments ?? null,
        snippet: (h.story_text || h.url || '').slice(0, 300) || null,
      })
    }
  }
  return [...seen.values()]
}

// ---------- LLM relevance pass ----------

// One cheap call over the whole candidate list. Strict-JSON contract; a
// candidate the model skips defaults to relevant:false (fail closed — a hook
// must never cite a thread nobody vetted).
async function classify(anthropic, account, candidates) {
  const name = subjectDisplayName(account)
  const category =
    account.g2?.products?.[0]?.categories?.[0] ?? account.firmographics?.categories?.[0] ?? null
  const list = candidates
    .map(
      (t, i) =>
        `${i}. [${t.source}${t.subreddit ? ` ${t.subreddit}` : ''}] "${t.title}"${t.snippet ? ` — ${t.snippet.slice(0, 200)}` : ''}`
    )
    .join('\n')
  const prompt = `Company: ${name} (domain: ${account.domain ?? 'unknown'}${category ? `, category: ${category}` : ''}).

Below are community threads that MAY be about this company. Many will be about something else that shares the name — judge carefully.

For each, answer: is it about THIS company (relevant), is it actual user/product feedback or discussion of their product (feedback) vs a passing mention or news, and the sentiment toward the company (positive|negative|mixed|neutral).

${list}

Reply with ONLY a JSON array, one object per thread, no prose:
[{"i": 0, "relevant": true, "feedback": false, "sentiment": "neutral", "note": "one short line why"}, ...]`

  const resp = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: CLASSIFY_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    },
    { timeout: LLM_TIMEOUT_MS }
  )
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error('classifier returned no JSON array')
  const verdicts = new Map()
  for (const v of JSON.parse(match[0])) {
    if (Number.isInteger(v?.i)) verdicts.set(v.i, v)
  }
  return candidates.map((t, i) => {
    const v = verdicts.get(i)
    return {
      ...t,
      relevant: v?.relevant === true,
      feedback: typeof v?.feedback === 'boolean' ? v.feedback : null,
      sentiment: ['positive', 'negative', 'mixed', 'neutral'].includes(v?.sentiment) ? v.sentiment : null,
      note: typeof v?.note === 'string' ? v.note.slice(0, 200) : null,
    }
  })
}

// Deterministic one-liner — never an LLM paraphrase.
function buildSummary(threads, sourcesChecked) {
  const rel = threads.filter((t) => t.relevant)
  if (!rel.length) {
    const skipped = sourcesChecked.find((s) => s.status === 'skipped_no_creds')
    return `no relevant community threads found in the last ${WINDOW_DAYS} days${skipped ? ` (${skipped.source} not checked — no creds)` : ''}`
  }
  const fb = rel.filter((t) => t.feedback === true)
  const top = fb[0] ?? rel[0]
  const where = top.subreddit ?? (top.source === 'hackernews' ? 'HN' : top.source)
  return `${rel.length} relevant thread${rel.length === 1 ? '' : 's'} (${fb.length} product feedback); top: ${where} "${top.title.slice(0, 60)}" ${top.created ?? ''}`.trim()
}

// ---------- runner ----------

const inFlight = new Map()

export function runCommunity(slug) {
  if (!inFlight.has(slug)) {
    inFlight.set(
      slug,
      doRun(slug).finally(() => inFlight.delete(slug))
    )
  }
  return inFlight.get(slug)
}

async function doRun(slug) {
  const file = accountFile(slug)
  if (!file) throw err('not-found', `bad slug "${slug}"`)
  let account
  try {
    account = JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    throw err('not-found', `no account file for "${slug}"`)
  }

  const sourcesChecked = []
  let candidates = []

  const creds = await readRedditCreds()
  if (!creds) {
    sourcesChecked.push({
      source: 'reddit',
      status: 'skipped_no_creds',
      note: `Keychain "${KEYCHAIN_SERVICE}" missing — store client_id:client_secret to enable`,
    })
  } else {
    try {
      const reddit = await searchReddit(account, creds)
      candidates.push(...reddit)
      sourcesChecked.push({ source: 'reddit', status: 'ok', note: `${reddit.length} candidates` })
    } catch (e) {
      sourcesChecked.push({ source: 'reddit', status: 'error', note: e.message.slice(0, 200) })
    }
  }

  try {
    const hn = await searchHackerNews(account)
    candidates.push(...hn)
    sourcesChecked.push({ source: 'hackernews', status: 'ok', note: `${hn.length} candidates` })
  } catch (e) {
    sourcesChecked.push({ source: 'hackernews', status: 'error', note: e.message.slice(0, 200) })
  }

  // Newest first, capped before the LLM pass so the classify call stays cheap.
  candidates = candidates
    .sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''))
    .slice(0, MAX_THREADS)

  let threads = []
  if (candidates.length) {
    let anthropic
    try {
      anthropic = await getClient()
    } catch {
      throw err('no-key', 'Anthropic API key not set in the macOS Keychain')
    }
    try {
      threads = await classify(anthropic, account, candidates)
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        invalidateClient()
        throw err('auth', 'Anthropic API key was rejected — update the Keychain entry and retry.')
      }
      throw err('api', `relevance pass failed: ${e.message}`)
    }
  }

  account.community = {
    threads,
    sources_checked: sourcesChecked,
    summary: buildSummary(threads, sourcesChecked),
    as_of: nowIso(),
  }
  // refreshed_at deliberately untouched — section-only update.

  const validate = await getValidator()
  if (!validate(account)) {
    throw err('invalid', `updated dossier failed schema validation: ${JSON.stringify(validate.errors?.slice(0, 3))}`)
  }
  const tmp = `${file}.community-tmp.json`
  await fs.writeFile(tmp, JSON.stringify(account, null, 2) + '\n')
  await fs.rename(tmp, file)

  return account.community
}
