#!/usr/bin/env node
// Draft tier A/B (2026-09-08). Re-drafts a sample of today's real due rows on
// two models and scores both on the things that actually degraded — so the
// model tier is a measured decision, not a vibe.
//
// Why a sample of REAL rows rather than a synthetic set: angle diversity across
// colleagues is the metric that matters most, and it only exists when several
// contacts at one account are drafted in the same run with the same
// batchContext the morning batch uses. So the sample is chosen ACCOUNT-WISE —
// whole accounts with >= 2 due contacts — not by picking N rows at random.
//
// usage:
//   node scripts/draft-ab.js                      # today's due file, 4 accounts
//   node scripts/draft-ab.js --date 2026-09-08 --accounts 5
//   node scripts/draft-ab.js --models claude-sonnet-5,claude-opus-5
//   node scripts/draft-ab.js --dry-run            # show the sample + cost estimate only
import fs from 'node:fs/promises'
import path from 'node:path'
import { config, paths } from '../lib/config.js'

const argv = process.argv.slice(2)
const opt = (n, d) => {
  const i = argv.indexOf(`--${n}`)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d
}
const DRY = argv.includes('--dry-run')
const DATE = opt('date', new Date().toLocaleDateString('en-CA'))
const N_ACCOUNTS = parseInt(opt('accounts', '4'), 10)
// Cap contacts per account: 5 colleagues is already 10 pairwise comparisons,
// which is plenty to measure opener overlap. Taking all 10 of MenuSifu's just
// doubles the bill for the same signal.
const PER_ACCOUNT = parseInt(opt('per-account', '5'), 10)
const MODELS = opt('models', 'claude-sonnet-5,claude-opus-5').split(',').map((s) => s.trim())
const BASE = `http://127.0.0.1:${config.server?.port ?? 4680}`

// $/1M tokens, 2026-09. Cache write is 1.25x input, cache read 0.1x input.
const PRICES = {
  'claude-opus-5': { in: 5, out: 25 },
  'claude-opus-4-8': { in: 5, out: 25 },
  'claude-sonnet-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
}
const priceOf = (model, u) => {
  const p = PRICES[model]
  if (!p) return null
  return (
    (u.input_tokens * p.in +
      u.cache_creation_input_tokens * p.in * 1.25 +
      u.cache_read_input_tokens * p.in * 0.1 +
      u.output_tokens * p.out) /
    1e6
  )
}

// ---------- objective scorers ----------
// Everything here is mechanical. Judgement calls (is this angle actually good?)
// stay with Declan — the point of these is to surface the failures that are
// countable, so the human read is spent on the part that isn't.

const SIGNATURE_RE = /\n\s*(declan|best|thanks|cheers)[\s,]*$/i

// gates.md's we-we rule: <=2 self-references in the BODY, excluding the
// back-of-email self-intro and the signature. Counting it here catches a draft
// that self-scores 1 while actually running 4 — the exact regression the
// 2026-08-12 effort:low experiment produced.
// gates.md: "Count every I, we, our, my, G2, and any G2 product/report name in
// the body" — but with an explicit carve-out that decides most of the count:
// "G2 may appear when the fact is about THEM." "Your G2 profile has 5 reviews"
// is about them; "G2's new report shows…" / "I manage the G2 partnership" is
// about us. A bare \bG2\b regex counts both and marks nearly every draft as
// under-scored, which is what the first version of this did — the drafts were
// mostly right and the measurement was wrong.
//
// So: first-person pronouns always count. "G2" counts only in shapes that are
// unambiguously G2-as-us (possessive, or "at/from/here at G2"). Bare "G2" as
// part of THEIR asset ("on G2", "your G2 profile", "G2 reviews") is reported
// separately as g2_mentions for a human to eyeball, never silently counted —
// this errs toward under-counting rather than crying wolf.
// ['’] throughout: drafts come back with curly apostrophes, so a straight-quote
// -only class silently misses "G2’s" and every "I’ve"/"we’re".
const US_G2 = /\bG2['’]?s\b|\b(?:at|from|here at|with)\s+G2\b|\bthe G2 (?:partnership|team|report)\b/gi
function stripExempt(body) {
  return (body ?? '')
    .replace(SIGNATURE_RE, '')
    // the sanctioned back-of-email self-intro (anatomy.md Email 1)
    .replace(/nice to meet you either way\.[^\n]*/gi, '')
}
function countSelfRefs(body) {
  const t = stripExempt(body)
  const pronouns = (t.match(/\b(I|I['’](?:m|ve|d)|my|me|we|we['’](?:re|ve)|our|ours|us)\b/g) ?? []).length
  const usG2 = (t.match(US_G2) ?? []).length
  return pronouns + usG2
}
// Bare G2 mentions not already counted as G2-as-us — informational only.
function countG2Mentions(body) {
  const t = stripExempt(body).replace(US_G2, '')
  return (t.match(/\bG2\b/g) ?? []).length
}

// gates.md bans both figures on every channel. Cheap regexes, deliberately
// conservative — a hit is worth a human look, not an automatic fail.
const LITOTES = /\b(not uncommon|no small feat|not the worst|hardly surprising|isn't nothing|not unusual|not unlike)\b/i
const CONTRASTIVE = /\b(it'?s not [a-z]+,? it'?s|not just [a-z]+,? but|isn'?t [a-z]+ anymore,? it'?s)\b/i
const ABSTRACT_ACTOR =
  /\b(the (language|story|signal|conversation|narrative|shift|momentum|perception)) (is |are |that )?[a-z]+ing\b/i

const wordCount = (s) => (s ?? '').trim().split(/\s+/).filter(Boolean).length

// Content words of the opening line — the basis for cross-colleague overlap.
const STOP = new Set('the a an and or but if of to in on at for with your you их is are was were be been it that this these those as by from has have had not no'.split(/\s+/))
function openerTokens(body) {
  const first = (body ?? '').split('\n').filter((l) => l.trim())[1] ?? ''
  return new Set(
    first.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 3 && !STOP.has(w))
  )
}
const jaccard = (a, b) => {
  if (!a.size || !b.size) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  return inter / (a.size + b.size - inter)
}

// ---------- sample ----------
const dayFile = path.join(paths.dataDir, 'drafts', `due-${DATE}.json`)
let day
try {
  day = JSON.parse(await fs.readFile(dayFile, 'utf8'))
} catch {
  console.error(`no due file at ${dayFile} — pass --date for a day that exists`)
  process.exit(1)
}
const byAccount = new Map()
for (const e of day.drafts ?? []) {
  if (!e.contactId || !e.accountId) continue
  if (!byAccount.has(e.accountId)) byAccount.set(e.accountId, [])
  byAccount.get(e.accountId).push(e)
}
// Accounts with the most colleagues first — that is where diversity is
// measurable and where the failure mode actually shows up.
const sample = [...byAccount.entries()]
  .filter(([, es]) => es.length >= 2)
  .sort((a, b) => b[1].length - a[1].length)
  .slice(0, N_ACCOUNTS)
  .map(([acct, es]) => [acct, es.slice(0, PER_ACCOUNT)])

const totalDrafts = sample.reduce((n, [, es]) => n + es.length, 0) * MODELS.length
console.log(`sample: ${sample.length} accounts, ${totalDrafts / MODELS.length} contacts x ${MODELS.length} models = ${totalDrafts} drafts`)
for (const [acct, es] of sample) console.log(`  ${acct.padEnd(28)} ${es.length} contacts`)
if (DRY) {
  console.log(`\ndry run — nothing drafted. Rough cost: $${(totalDrafts * 0.09).toFixed(2)}-${(totalDrafts * 0.13).toFixed(2)}.`)
  process.exit(0)
}

// ---------- run ----------
async function draftOne(entry, model, batchContext) {
  const res = await fetch(`${BASE}/api/draft`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contactId: entry.contactId,
      kind: 'next',
      dueStep: entry.step || undefined,
      batchContext: batchContext || undefined,
      model,
    }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`)
  let done = null
  for (const line of (await res.text()).split('\n')) {
    if (!line.trim()) continue
    const evt = JSON.parse(line)
    if (evt.type === 'done') done = evt
    if (evt.type === 'error') throw new Error(evt.error)
  }
  return done
}

const runs = {}
for (const model of MODELS) {
  console.log(`\n=== ${model} ===`)
  runs[model] = []
  for (const [, entries] of sample) {
    // Rebuild batchContext exactly like the morning batch does, per account,
    // so the anti-duplicate-opener guard is under test too.
    const ctx = []
    for (const e of entries) {
      process.stdout.write(`  ${(e.name ?? e.contactId).slice(0, 26).padEnd(28)} `)
      try {
        const done = await draftOne(e, model, ctx.length ? ctx.join('\n') : undefined)
        const d = done?.draft
        if (!d?.body) throw new Error('no parsed draft')
        runs[model].push({ account: e.accountId, name: e.name, step: e.step, draft: d, usage: done.usage })
        ctx.push(`${e.name}: [${d.play ?? '?'}] ${d.subject ?? ''} — ${(d.body ?? '').split('\n').filter(Boolean)[1] ?? ''}`)
        console.log(`ok  ${wordCount(d.body)}w  $${(priceOf(model, done.usage) ?? 0).toFixed(3)}`)
      } catch (err) {
        console.log(`FAIL ${err.message.slice(0, 60)}`)
      }
    }
  }
}

// ---------- score ----------
console.log(`\n${'='.repeat(72)}\nSCORECARD  (${DATE}, ${sample.length} accounts)\n${'='.repeat(72)}`)
const rows = []
for (const model of MODELS) {
  const rs = runs[model]
  if (!rs.length) continue
  const cost = rs.reduce((s, r) => s + (priceOf(model, r.usage) ?? 0), 0)
  const outTok = rs.reduce((s, r) => s + r.usage.output_tokens, 0)

  // scorecard honesty: claimed self_refs vs counted
  let honest = 0, over = 0, overBudget = 0, g2Total = 0
  for (const r of rs) {
    const claimed = r.draft.scorecard?.self_refs
    const actual = countSelfRefs(r.draft.body)
    g2Total += countG2Mentions(r.draft.body)
    if (actual > 2) overBudget++ // the rule itself, independent of self-scoring
    if (claimed == null) continue
    if (actual > claimed) over++
    else honest++
  }
  // banned figures
  const banned = rs.filter(
    (r) => LITOTES.test(r.draft.body) || CONTRASTIVE.test(r.draft.body) || ABSTRACT_ACTOR.test(r.draft.body)
  ).length
  // word limit (emails only)
  const longEmails = rs.filter((r) => r.draft.channel === 'email' && wordCount(r.draft.body) > 100).length
  // cross-colleague opener overlap, per account, averaged
  const overlaps = []
  for (const [acct] of sample) {
    const mine = rs.filter((r) => r.account === acct)
    for (let i = 0; i < mine.length; i++)
      for (let j = i + 1; j < mine.length; j++)
        overlaps.push(jaccard(openerTokens(mine[i].draft.body), openerTokens(mine[j].draft.body)))
  }
  const avgOverlap = overlaps.length ? overlaps.reduce((a, b) => a + b, 0) / overlaps.length : 0
  // distinct plays chosen — a proxy for angle range
  const plays = new Set(rs.map((r) => r.draft.play)).size

  rows.push({
    model,
    n: rs.length,
    cost,
    perDraft: cost / rs.length,
    avgOut: Math.round(outTok / rs.length),
    selfRefOver: over,
    selfRefN: honest + over,
    overBudget,
    g2PerDraft: g2Total / rs.length,
    banned,
    longEmails,
    avgOverlap,
    plays,
  })
}
const pct = (x) => `${(x * 100).toFixed(0)}%`
console.log(
  ['model', 'n', '$/draft', 'out tok', 'underscored', 'banned figs', '>100w', 'opener overlap', 'plays']
    .map((h, i) => (i === 0 ? h.padEnd(18) : h.padStart(14)))
    .join('')
)
for (const r of rows) {
  console.log(
    [
      r.model.padEnd(18),
      String(r.n).padStart(14),
      `$${r.perDraft.toFixed(3)}`.padStart(14),
      String(r.avgOut).padStart(14),
      `${r.selfRefOver}/${r.selfRefN}`.padStart(14),
      `${r.overBudget}/${r.n}`.padStart(14),
      String(r.banned).padStart(14),
      String(r.longEmails).padStart(14),
      pct(r.avgOverlap).padStart(14),
      String(r.plays).padStart(14),
    ].join('')
  )
}
console.log(`
  underscored     = drafts whose scorecard claimed FEWER self-refs than the body contains (lower is better)
  >2 self-refs    = drafts actually breaching gates.md's we-we budget of 2 (lower is better). Counts I/we/our/my/us
                    plus G2-as-us ("G2's report", "at G2"); bare "G2" about THEIR profile is exempt per gates.md
  banned figs     = litotes / contrastive negation / abstraction-as-actor hits (lower is better)
  opener overlap  = avg word overlap between two colleagues' opening lines at the same account (LOWER is better —
                    this is the "five people got the same email" metric)
  plays           = distinct plays chosen across the sample (higher = more range)`)

const daily = rows.map((r) => `${r.model}: $${(r.perDraft * 212).toFixed(2)}/day  ~$${(r.perDraft * 212 * 21).toFixed(0)}/mo`).join('\n  ')
console.log(`\nextrapolated to 212 drafts/day:\n  ${daily}`)

const out = path.join(paths.dataDir, 'drafts', `ab-${DATE}.json`)
await fs.writeFile(out, JSON.stringify({ date: DATE, models: MODELS, scorecard: rows, runs }, null, 2) + '\n')
console.log(`\nfull drafts written to ${out} — read them side by side before deciding.`)
