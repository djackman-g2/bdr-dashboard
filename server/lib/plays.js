// Plays library access + the hook-angle matcher (the ⚡ popover on tracker
// contact rows). A play .md may start with a frontmatter block (see
// data/plays/README.md) that makes it machine-matchable: `trigger:` says when
// it auto-fires for an account, `hook:` is a {token}-templated one-liner the
// server fills with real dossier facts — angle × proof, no LLM call, so the
// popover is instant and can never invent a number. Files without frontmatter
// (anatomy/stats/README) are invisible to the matcher but still feed drafting.
//
// Guardrails enforced here, not by convention: the ai_visibility honesty rule
// is a code branch (appeared companies can only ever get `hook_appeared:`),
// 6sense fields are simply not extracted, and CRM loss reasons route the
// winback trigger without ever entering the hook text.
import fs from 'node:fs/promises'
import path from 'node:path'
import { paths } from './config.js'
import { personas } from '../../data/personas.js'

const PLAYS_DIR = path.join(paths.dataDir, 'plays')

export const KNOWN_TRIGGERS = ['ai_visibility', 'community', 'closed_lost', 'no_history', 'mid_flow', 'persona', 'manual']

// Base priority per trigger; the account's declared playType adds a boost that
// puts its play on top. ai_visibility scores split absent vs appeared.
const TRIGGER_SCORE = { ai_visibility: 100, community: 95, closed_lost: 90, no_history: 60, mid_flow: 50, persona: 40 }
const PLAYTYPE_AFFINITY = { AEO: 'aeo-screenshot', 'buyer-intent': 'buyer-intent', winback: 'winback' }

// ---------- frontmatter ----------

// Minimal single-line `key: value` parser between --- markers at the top of
// the file. No YAML dep: values are strings; `personas` becomes a list.
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { meta: null, body: text }
  const end = text.indexOf('\n---', 3)
  if (end < 0) return { meta: null, body: text }
  const meta = {}
  for (const line of text.slice(3, end).split('\n')) {
    const m = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!m) continue
    let value = m[2].trim()
    // Allow quoting so hooks may contain a leading # or trailing colonry.
    if (/^".*"$/.test(value)) value = value.slice(1, -1)
    meta[m[1]] = value
  }
  if (meta.personas) meta.personas = meta.personas.split(',').map((s) => s.trim()).filter(Boolean)
  return { meta, body: text.slice(end + 4) }
}

export async function loadPlays() {
  let files
  try {
    files = (await fs.readdir(PLAYS_DIR)).filter((f) => f.endsWith('.md')).sort()
  } catch {
    return []
  }
  const plays = []
  for (const file of files) {
    const { meta } = parseFrontmatter(await fs.readFile(path.join(PLAYS_DIR, file), 'utf8'))
    if (!meta?.trigger) continue // not a matchable play (anatomy, stats, README)
    plays.push({
      file,
      slug: file.replace(/\.md$/, ''),
      label: meta.label ?? file.replace(/\.md$/, ''),
      personas: meta.personas?.length ? meta.personas : ['any'],
      trigger: meta.trigger,
      hook: meta.hook ?? null,
      hookAppeared: meta.hook_appeared ?? null,
    })
  }
  return plays
}

// ---------- create (the "+ new play" flow) ----------

export async function createPlay({ name, personas: personaList, trigger, hook, notes }) {
  const bad = (msg) => Object.assign(new Error(msg), { code: 'bad-input' })
  if (typeof name !== 'string' || !name.trim() || name.trim().length > 60) {
    throw bad('name is required (≤60 chars)')
  }
  trigger = trigger || 'persona'
  if (!KNOWN_TRIGGERS.includes(trigger)) throw bad(`trigger must be one of: ${KNOWN_TRIGGERS.join(', ')}`)
  const list = Array.isArray(personaList) && personaList.length ? personaList : ['any']
  for (const p of list) {
    if (p !== 'any' && !personas[p]) throw bad(`unknown persona "${p}" — keys come from data/personas.js`)
  }
  const oneLineHook = typeof hook === 'string' ? hook.replace(/\s*\n\s*/g, ' ').trim() : ''
  if (!oneLineHook && trigger !== 'manual') throw bad('hook template is required for auto-firing plays')

  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  if (!slug) throw bad('name must contain letters or digits')
  const file = path.join(PLAYS_DIR, `${slug}.md`)
  if (path.dirname(path.resolve(file)) !== path.resolve(PLAYS_DIR)) throw bad('bad play name')
  try {
    await fs.access(file)
    throw bad(`a play named "${slug}" already exists — edit data/plays/${slug}.md instead`)
  } catch (err) {
    if (err.code === 'bad-input') throw err // fs.access succeeded → collision
  }

  const content = [
    '---',
    `label: ${name.trim()}`,
    `personas: ${list.join(', ')}`,
    `trigger: ${trigger}`,
    ...(oneLineHook ? [`hook: ${oneLineHook}`] : []),
    '---',
    '',
    `# Play: ${name.trim()}`,
    '',
    `Added from the dashboard ${new Date().toISOString().slice(0, 10)}.`,
    ...(notes?.trim() ? ['', notes.trim()] : []),
    '',
  ].join('\n')
  await fs.writeFile(file, content)
  return { slug, file: `data/plays/${slug}.md` }
}

// ---------- fact extraction ----------

async function loadDossier(slug) {
  const file = path.join(paths.accountsDir, `${slug}.json`)
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch {
    return null
  }
}

async function loadMirrorEntry(contact) {
  try {
    const mirror = JSON.parse(await fs.readFile(path.join(paths.dataDir, 'outreach.json'), 'utf8'))
    return (
      (contact.sfContactId && mirror.contacts.find((o) => o.sf_contact_id === contact.sfContactId)) ||
      (contact.name && mirror.contacts.find((o) => o.name?.toLowerCase() === contact.name.toLowerCase())) ||
      null
    )
  } catch {
    return null
  }
}

const CLOSED_LOST_RE = /closed[\s-]?lost|churn|non[\s-]?renew|did not renew|cancell|parted ways/i

function extractFacts({ dossier, contact, account }) {
  const facts = { company: account?.name ?? dossier?.name ?? contact.accountId }
  if (contact.name) facts.name = contact.name

  const products = dossier?.g2?.products ?? []
  const category = products.find((p) => p.categories?.length)?.categories?.[0] ?? dossier?.firmographics?.categories?.[0]
  if (category) facts.category = category
  const reviewed = products.filter((p) => p.review_count != null)
  if (reviewed.length) {
    const n = Math.max(...reviewed.map((p) => p.review_count))
    facts.review_count = String(n)
    // Aggravator only while the count is actually low — at scale the line lies.
    if (n < 100) {
      facts.review_line = `, and ${facts.company} has ${n} review${n === 1 ? '' : 's'} on G2 — the answer gets assembled from everyone else's footprint`
    }
  }
  facts.review_line ??= ''
  const slug = products[0]?.slug
  if (slug) facts.profile_url = `https://www.g2.com/products/${slug}/reviews`

  const recent = dossier?.salesforce?.reviews_last_60_days
  facts.recent_reviews_line =
    recent != null && recent <= 5 ? `; only ${recent} review${recent === 1 ? '' : 's'} added in the last 60 days` : ''

  // g2.buyer_intent: aggregate counts only (names never reach the dossier —
  // named intent claims stay seller-console-gated). A zero count is real data
  // but not a hook, so the tokens only fill when there's something to say.
  const intent = dossier?.g2?.buyer_intent
  if (intent?.company_count > 0) {
    facts.intent_company_count = String(intent.company_count)
    if (intent.since) {
      const d = new Date(intent.since + 'T00:00:00')
      facts.intent_since = isNaN(d) ? intent.since : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })
    }
    // Pre-composed sentence so hooks read grammatically with or without data.
    facts.intent_line = `${intent.company_count} companies have researched ${facts.company} on G2${facts.intent_since ? ` since ${facts.intent_since}` : ''} — that activity resolves to named accounts. `
  }
  facts.intent_line ??= ''

  // community: the best VETTED thread — LLM-classified relevant, product
  // feedback preferred, newest first. Hooks only ever cite a thread the
  // classifier passed; the play's read-it-first guardrail still applies.
  const threads = (dossier?.community?.threads ?? []).filter((t) => t.relevant)
  if (threads.length) {
    const best =
      [...threads].sort(
        (a, b) => (b.feedback === true) - (a.feedback === true) || (b.created ?? '').localeCompare(a.created ?? '')
      )[0]
    facts.thread_title = best.title.length > 80 ? best.title.slice(0, 77) + '…' : best.title
    facts.thread_url = best.url
    facts.thread_source = best.subreddit ?? (best.source === 'hackernews' ? 'Hacker News' : best.source)
    facts.thread_date = best.created ?? null
    facts.community_as_of = dossier.community.as_of
  }

  // ai_visibility: pick the strongest query — an absence beats an appearance.
  const queries = dossier?.ai_visibility?.queries ?? []
  if (queries.length) {
    const absent = queries.find((q) => q.company_appeared === false)
    const q = absent ?? queries[0]
    facts.ai_appeared = !absent
    facts.ai_question = q.prompt.length > 90 ? q.prompt.slice(0, 87) + '…' : q.prompt
    const self = facts.company.toLowerCase()
    const rivals = (q.companies_returned ?? []).filter((c) => c.toLowerCase() !== self)
    if (rivals.length) facts.competitor_count = String(rivals.length)
    facts.ai_as_of = dossier.ai_visibility.as_of
  }

  return facts
}

// {token} / {token|fallback} fill. A missing token with no fallback returns
// null so the caller drops the offer instead of showing a broken sentence.
function fillTemplate(template, facts) {
  let missing = false
  const out = template.replace(/\{(\w+)(?:\|([^}]*))?\}/g, (_, token, fallback) => {
    const v = facts[token]
    if (v !== undefined && v !== null) return v
    if (fallback !== undefined) return fallback
    missing = true
    return ''
  })
  return missing ? null : out
}

// ---------- the matcher ----------

// Offers for one contact: every frontmattered play whose trigger fires for
// this account/contact, hooks filled with real facts, sorted by relevance.
// The generic persona angle rides along at the bottom as the always-there
// fallback (it's what the old ⚡ button pasted).
export async function hookAngles(contact, account) {
  const [plays, dossier, mirror] = await Promise.all([
    loadPlays(),
    loadDossier(contact.accountId),
    loadMirrorEntry(contact),
  ])
  const facts = extractFacts({ dossier, contact, account })
  const offers = []

  for (const play of plays) {
    if (play.trigger === 'manual') continue
    if (contact.persona && !play.personas.includes('any') && !play.personas.includes(contact.persona)) continue

    let fired = null // { why, score, template }
    switch (play.trigger) {
      case 'ai_visibility': {
        if (facts.ai_question === undefined) break
        fired = facts.ai_appeared
          ? play.hookAppeared && {
              why: `ai_visibility ${facts.ai_as_of?.slice(0, 10) ?? ''}: company APPEARS in the AI answer — flipped angle`,
              score: 70,
              template: play.hookAppeared,
            }
          : {
              why: `ai_visibility ${facts.ai_as_of?.slice(0, 10) ?? ''}: absent from the AI answer${facts.competitor_count ? ` (${facts.competitor_count} competitors returned)` : ''}`,
              score: TRIGGER_SCORE.ai_visibility,
              template: play.hook,
            }
        break
      }
      case 'community':
        if (facts.thread_url) {
          fired = {
            why: `community ${facts.community_as_of?.slice(0, 10) ?? ''}: real ${facts.thread_source} thread (${facts.thread_date ?? 'undated'}) — READ IT before sending`,
            score: TRIGGER_SCORE.community,
            template: play.hook,
          }
        }
        break
      case 'closed_lost':
        if (CLOSED_LOST_RE.test(dossier?.salesforce?.crm_history_notes ?? '')) {
          fired = { why: 'CRM history shows closed-lost / non-renewal (check tone tiers before drafting)', score: TRIGGER_SCORE.closed_lost, template: play.hook }
        }
        break
      case 'no_history':
        if (!mirror && !contact.lastTouch) {
          fired = { why: 'no Groove touches on record — cold first touch', score: TRIGGER_SCORE.no_history, template: play.hook }
        }
        break
      case 'mid_flow':
        if (mirror?.flow_day != null && !mirror.replied) {
          fired = { why: `in a Groove flow (day ${mirror.flow_day}), no reply yet`, score: TRIGGER_SCORE.mid_flow, template: play.hook }
        }
        break
      case 'persona':
        if (contact.persona && play.personas.includes(contact.persona)) {
          fired = { why: `${contact.persona} persona angle`, score: TRIGGER_SCORE.persona, template: play.hook }
        }
        break
    }
    if (!fired || !fired.template) continue
    const hook = fillTemplate(fired.template, facts)
    if (hook === null) continue
    const boosted = PLAYTYPE_AFFINITY[account?.playType] === play.slug
    offers.push({
      play: play.slug,
      label: play.label,
      hook,
      why: boosted ? `${fired.why} · account play type: ${account.playType}` : fired.why,
      score: fired.score + (boosted ? 100 : 0),
    })
  }

  const p = contact.persona && personas[contact.persona]
  if (p?.hookAngle) {
    offers.push({
      play: null,
      label: 'persona angle (generic)',
      hook: p.hookAngle,
      why: `starting point only — personalize with: ${p.proofToPull}`,
      score: 10,
    })
  }

  offers.sort((a, b) => b.score - a.score)
  return { contactId: contact.id, dossier: !!dossier, offers }
}
