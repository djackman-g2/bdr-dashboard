// 7G-1 — AI-visibility runner (the AEO play, automated). Answers: does this
// company show up when a buyer asks an LLM for a shortlist in their category,
// and who gets cited? Plain server-side completions through the same client
// as the chat panel (LiteLLM proxy, Keychain key) — NOT an MCP call, NOT part
// of headless Claude's tool surface. Prompts are built only from dossier data
// already on disk; a competitor is never invented (head-to-head runs only
// against a company the shortlist answer itself returned).
// Honesty rule: company_appeared is data, not copy — if the company DOES
// appear, the angle flips to "who controls whether that continues".
import fs from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { config, paths } from './config.js'
import { getClient, invalidateClient, CHAT_MODEL } from './chat.js'

const avConfig = config.ai_visibility ?? {}
const MODEL = avConfig.model ?? CHAT_MODEL
const MAX_TOKENS = avConfig.max_tokens ?? 1200
const EXCERPT_CHARS = avConfig.max_excerpt_chars ?? 2000
const REQUEST_TIMEOUT_MS = 90_000

// The simulated buyer sees no dossier and no G2 affiliation — the point is
// what a generic LLM tells a stranger, not what our research says.
const BUYER_SYSTEM =
  'You are answering a software buyer doing quick research. Answer naturally and concisely, naming specific products/companies, as you would for anyone asking.'

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

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// Company names that double as ordinary English words ("You", "Button",
// "Measured") match any prose and make company_appeared a false positive —
// those only count via their domain. Short names are suspect too.
const GENERIC_NAMES = new Set(['you', 'button', 'measured', 'one', 'box', 'wave', 'clear', 'simple', 'focus'])
export const isWeakName = (name) => name.length < 5 || GENERIC_NAMES.has(name.toLowerCase())

// Name/domain variants that count as "the company appeared".
// (Exported for the community module — same generic-name lesson applies.)
export function subjectVariants(account) {
  const variants = new Set()
  const name = (account.name ?? '').trim()
  if (name && !isWeakName(name)) {
    variants.add(name)
    const stripped = name.replace(/[,.]?\s+(inc|llc|corp|corporation|ltd|co|group|technologies|software)\.?$/i, '').trim()
    if (stripped.length >= 5 && !isWeakName(stripped)) variants.add(stripped)
  }
  if (account.domain) variants.add(account.domain)
  return [...variants]
}

// What to call the company in prompts: generic names go by their domain
// ("You.com", not "You") so the question is unambiguous to the model too.
export function subjectDisplayName(account) {
  const name = (account.name ?? '').trim()
  return name && !isWeakName(name) ? name : (account.domain ?? name)
}

function textMentions(text, variant) {
  return new RegExp(`(^|[^a-z0-9])${escapeRe(variant)}([^a-z0-9]|$)`, 'i').test(text)
}

// Companies the answer returned — heuristic over list/bold structure. Good
// enough for shortlist-style answers; the raw excerpt is the ground truth.
function parseCompanies(text) {
  const names = []
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:[-*•]|\d+[.)])\s+\**([^*:—–]{2,60}?)\**\s*(?:[:—–]|\s-\s|$)/)
    if (!m) continue
    const name = m[1].replace(/\*+/g, '').trim()
    const words = name.split(/\s+/)
    if (!name || words.length > 4) continue
    if (!/^[A-Z0-9]/.test(name)) continue
    // Multi-word entries must look like a proper name (a capitalized/branded
    // later token), not a prose phrase ("Data/training requirements").
    if (words.length > 1 && !words.slice(1).some((w) => /^[A-Z0-9(]|\.(com|io|ai|co)/.test(w))) continue
    if (/^(and|the|for|with|best|top|note|also|other|pricing|pros|cons|what|when|why|how|if|you)\b/i.test(name)) continue
    if (!names.some((n) => n.toLowerCase() === name.toLowerCase())) names.push(name)
  }
  return names.slice(0, 15)
}

// Domains/URLs the answer cited or mentioned.
function parseSources(text) {
  const sources = new Set()
  for (const m of text.matchAll(/https?:\/\/([^\s/)\]>"']+)[^\s)\]>"']*/gi) ?? []) {
    sources.add(m[1].toLowerCase().replace(/^www\./, ''))
  }
  for (const m of text.matchAll(/(^|[\s(])((?:[a-z0-9-]+\.)+(?:com|io|ai|co|org|net))\b/gi) ?? []) {
    sources.add(m[2].toLowerCase().replace(/^www\./, ''))
  }
  return [...sources].slice(0, 10)
}

async function runQuery(anthropic, prompt, variants) {
  const ran_at = nowIso()
  const resp = await anthropic.messages.create(
    {
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: BUYER_SYSTEM,
      messages: [{ role: 'user', content: prompt }],
    },
    { timeout: REQUEST_TIMEOUT_MS }
  )
  const text = resp.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
  const sources = parseSources(text)
  return {
    prompt,
    ran_at,
    model: resp.model ?? MODEL,
    company_appeared: variants.some((v) => textMentions(text, v)),
    companies_returned: parseCompanies(text),
    g2_cited: sources.includes('g2.com') || /(^|[^a-z0-9])g2([^a-z0-9]|$)/i.test(text),
    sources_cited: sources,
    raw_excerpt: text.slice(0, EXCERPT_CHARS),
  }
}

// Deterministic one-line wedge — never an LLM paraphrase of itself.
function buildSummary(queries, category, competitor) {
  if (!queries.length) return null
  const n = queries.length
  const appeared = queries.filter((q) => q.company_appeared).length
  const g2 = queries.filter((q) => q.g2_cited).length
  const parts = []
  const shortlist = queries[0]
  if (category) {
    if (shortlist.company_appeared) {
      parts.push(`appears in the "${category}" shortlist query`)
    } else {
      const top = shortlist.companies_returned.slice(0, 3).join(', ')
      parts.push(`absent from the "${category}" shortlist query${top ? ` (returned: ${top})` : ''}`)
    }
  }
  if (competitor) parts.push(`head-to-head run vs ${competitor}`)
  parts.push(`appeared in ${appeared}/${n} queries; G2 cited in ${g2}/${n}`)
  return parts.join('; ')
}

// In-flight dedupe: a double-clicked ⟳ or an overlapping deep-run hook reuses
// the running promise instead of paying for a second set of completions.
const inFlight = new Map()

export function runAiVisibility(slug) {
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

  let anthropic
  try {
    anthropic = await getClient()
  } catch {
    throw err('no-key', 'Anthropic API key not set in the macOS Keychain')
  }

  const variants = subjectVariants(account)
  const displayName = subjectDisplayName(account)
  const category =
    account.g2?.products?.[0]?.categories?.[0] ?? account.firmographics?.categories?.[0] ?? null

  const queries = []
  let competitor = null
  try {
    if (category) {
      const shortlist = await runQuery(anthropic, `What are the best ${category} tools?`, variants)
      queries.push(shortlist)
      // Head-to-head only against a company the shortlist itself returned —
      // never invent a competitor.
      competitor =
        shortlist.companies_returned.find((c) => !variants.some((v) => textMentions(c, v))) ?? null
      if (competitor) {
        queries.push(
          await runQuery(anthropic, `Compare ${displayName} vs ${competitor} — which is better and why?`, variants)
        )
      }
    }
    queries.push(
      await runQuery(anthropic, `${displayName} reviews — what do people say about them?`, variants)
    )
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      invalidateClient()
      throw err('auth', 'Anthropic API key was rejected — update the Keychain entry and retry.')
    }
    throw err('api', e.message ?? 'ai_visibility query failed')
  }

  account.ai_visibility = {
    queries,
    summary: buildSummary(queries, category, competitor),
    as_of: nowIso(),
  }
  // refreshed_at deliberately untouched — this is a section-only update.

  const validate = await getValidator()
  if (!validate(account)) {
    throw err('invalid', `updated dossier failed schema validation: ${JSON.stringify(validate.errors?.slice(0, 3))}`)
  }
  const tmp = `${file}.av-tmp.json`
  await fs.writeFile(tmp, JSON.stringify(account, null, 2) + '\n')
  await fs.rename(tmp, file)

  return account.ai_visibility
}
