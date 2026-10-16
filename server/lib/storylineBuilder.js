// Auto-storyline builder (2026-09-01). Plain server-side completion through
// the same client as ai_visibility.js/community.js — LiteLLM proxy, Keychain
// key, NOT an MCP call, NOT part of headless Claude's tool surface. Fires
// after a successful deep refresh (server/lib/queue.js) when the account has
// no storyline.json yet and enough icp_contacts to mesh a narrative across.
//
// Storylines were designed to be hand-authored only (data/plays/storyline.md,
// PLAN-STORYLINE.md) — this module produces the SAME file shape by the SAME
// rules, one direct LLM call, and never overwrites an existing file whether
// it was hand-authored or auto-built. Anything the model isn't confident
// about goes into verification[] as "pending" rather than asserted — that's
// the existing safety net: the Storyline card already renders pending items
// as a pre-send banner, so an auto-built storyline with open questions still
// surfaces them to Declan before any send, exactly like a hand-authored one.
import fs from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import Ajv from 'ajv'
import { config, paths } from './config.js'
import { getClient, invalidateClient, CHAT_MODEL } from './chat.js'

const sbConfig = config.storyline ?? {}
const MODEL = sbConfig.model ?? CHAT_MODEL
const MAX_TOKENS = sbConfig.max_tokens ?? 12000
const MIN_CONTACTS = sbConfig.min_contacts_for_auto_build ?? 3
const SCHEMA_PATH = path.join(paths.root, 'schema', 'storyline.schema.json')

const err = (code, message) => Object.assign(new Error(message), { code })
const nowIso = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
const today = () => new Date().toISOString().slice(0, 10)

function accountFile(slug) {
  const file = path.join(paths.accountsDir, `${slug}.json`)
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  return file
}
function storylineFile(slug) {
  const file = path.join(paths.accountsDir, `${slug}.storyline.json`)
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  return file
}

// The enrolled roster is the cast (2026-09-08). The builder used to take its
// cast from the dossier's icp_contacts — people RESEARCH found. But by the time
// a storyline is worth building, Declan has already picked the humans and
// enrolled them in a Groove flow, and Groove's due-list rows carry their real
// name/title/email/SFDC id. That roster is free, it is ground truth, and it is
// the exact set of people who will receive drafts — whereas icp_contacts from a
// brief run are all `unconfirmed` by construction and hard rule 5 keeps
// unconfirmed contacts out of copy entirely. A storyline meshed across
// researched strangers while the drafts go to a different five people is not a
// mesh at all.
//
// Written by scripts/prep-cohort.js (a Groove READ, allowed unattended); the
// builder itself never calls Groove, staying a pure LLM module like
// ai_visibility.js / community.js.
async function loadCastRoster(slug) {
  const file = path.join(paths.dataDir, 'groove', 'cast', `${slug}.json`)
  if (path.dirname(path.resolve(file)) !== path.resolve(path.join(paths.dataDir, 'groove', 'cast'))) return null
  try {
    const roster = JSON.parse(await fs.readFile(file, 'utf8'))
    const contacts = (roster.contacts ?? []).filter((c) => c.name)
    return contacts.length ? contacts : null
  } catch {
    return null
  }
}

let compiledValidator = null
async function getValidator() {
  if (!compiledValidator) {
    const schema = JSON.parse(await fs.readFile(SCHEMA_PATH, 'utf8'))
    const ajv = new Ajv({ strict: false, allErrors: true })
    compiledValidator = ajv.compile(schema)
  }
  return compiledValidator
}

const CONTRACT = `Return STRICT JSON only, no markdown fences, no commentary outside the JSON — one storyline object for this account:
{
  "account": "<company display name>",
  "slug": "<the slug given below>",
  "sf_account_id": "<from the dossier's salesforce section, or null>",
  "ae_owner": "<from the dossier's salesforce/tracker fields, or null>",
  "mode": "template_flow",
  "created": "<today's date, given below>",
  "source_session": "auto-storyline-builder",
  "spine": "<2-4 sentences: ONE account-level thesis grounded in real dossier facts — news, hiring, G2 presence, competitive position. This is what every contact's chapter argues from their own seat.>",
  "facts": { "<freeform keys>": "<only numbers/dates actually present in the dossier — never invent>" },
  "cast": [
    {
      "contact": "<name, must be one of the dossier's icp_contacts>",
      "title": "<title>",
      "email": "<email or null>",
      "sf_contact_id": "<or null>",
      "persona": "<persona>",
      "chapter": "<a short chapter label, e.g. 'pipeline', 'positioning', 'narrative'>",
      "chapter_angle": "<the ONE fact/angle this contact's drafts may use — must be distinct from every other cast member's angle>",
      "withheld_specific": "<the specific detail (a name, a full list, a number) this contact's FIRST email holds back and offers, delivered in full on the next touch>",
      "cta_rule": "<'ownership-routing only, never a time ask' for C-suite/founder/president personas; otherwise omit or state the normal interest-ask CTA>"
    }
  ],
  "pairings": { "<contact name>": { "cites": ["<another CAST member's name — someone else in THIS cast list that Declan is personally emailing as part of this same storyline, e.g. 'Michael cites Courtney' means Michael's draft may say he also reached out to Courtney. This needs NO claims_ledger entry — Declan controls his own sends and knows exactly what he sent.>"] } },
  "claims_ledger": [
    { "colleague": "<a person's name — almost always someone NOT in the cast list: a real prospect-side colleague that a G2 TEAMMATE (an AE or another rep, never Declan himself) has a genuine individual relationship with>", "state": "sent|replied|meeting|ae_thread_active", "evidence": "<one crisp sentence: the specific dated Gong/CRM fact proving an individual, reciprocal engagement — a real reply, an accepted meeting, an active back-and-forth thread. A mass campaign/email BURST sent to a dozen people at once is NOT evidence of an individual relationship — never use one as evidence here.>", "allowed": "<the exact phrasing this state permits, per storyline.md>", "requires": "<e.g. 'sync with X before first use', if applicable>" }
  ],
  "verification": [
    { "item": "<anything uncertain: identity, employment, ownership, a claim needing confirmation — keep each to one sentence>", "status": "pending", "fallback": "<what to do instead if this doesn't clear, one sentence>" }
  ]
}

Hard rules:
1. Only use contacts that appear in the dossier's icp_contacts. Never invent a person.
2. "mode" is "template_flow" unless the dossier gives a clear, concrete reason this account deserves full hand-governed treatment (e.g. explicit high-priority/strategic flag) — default to template_flow.
3. claims_ledger is ONLY for citing a G2 TEAMMATE's (an AE or another rep — never Declan's own) genuine INDIVIDUAL relationship with a prospect-side person. Requires a concrete, dated, individual/reciprocal fact from the dossier's gong/salesforce sections (a specific reply, an accepted meeting, an active back-and-forth thread). A mass email burst/campaign hitting many people at once is NEVER sufficient evidence — that is a blast, not a relationship. No qualifying evidence anywhere in the dossier = omit claims_ledger entirely (empty array). This is expected to be empty for most newly-generated storylines; do not strain to find a claims_ledger entry.
4. pairings is a SEPARATE, simpler mechanism: it only cites OTHER CAST MEMBERS (people already in THIS storyline's own cast list) that Declan himself is personally emailing — "cites" means this contact's draft may mention Declan also reached out to that other cast member. This needs no evidence/claims_ledger entry (Declan controls and knows his own sends). NEVER put a cast member's own name in claims_ledger, and never cite a cast member in pairings as if citing a claims_ledger colleague — they are different lists for different purposes. Omit "pairings" entirely if no mesh cross-reference genuinely fits.
5. Anything you are not fully confident about (a contact's current employment, who owns what, whether a fact is still true) goes into verification[] with status "pending" — never asserted as settled fact in spine/cast/facts.
6. chapter_angle must be genuinely distinct per contact — chapter discipline is the whole point of a storyline; two contacts sharing the same angle defeats it.
7. Do not include a "voice_reference_e1s" field or any drafted email copy — that is generated separately, per contact, at send time.
8. Every number/date in "facts" and every chapter_angle must trace to something literally present in the dossier JSON provided. Never invent a statistic.`

export async function buildStoryline(slug) {
  const outFile = storylineFile(slug)
  if (!outFile) throw err('not-found', `bad slug "${slug}"`)

  // Never overwrite — hand-authored or a prior auto-build, either way this
  // account already has one.
  try {
    await fs.access(outFile)
    return { skipped: 'exists' }
  } catch {
    /* doesn't exist yet — proceed */
  }

  const inFile = accountFile(slug)
  if (!inFile) throw err('not-found', `bad slug "${slug}"`)
  let dossierText
  let dossier
  try {
    dossierText = await fs.readFile(inFile, 'utf8')
    dossier = JSON.parse(dossierText)
  } catch {
    throw err('not-found', `no account file for "${slug}"`)
  }

  // A roster satisfies the minimum on its own: those people are getting drafts
  // today whether or not research ever found them.
  const roster = await loadCastRoster(slug)
  const contactCount = Math.max(roster?.length ?? 0, (dossier.icp_contacts ?? []).length)
  if (contactCount < MIN_CONTACTS) {
    return { skipped: 'insufficient_contacts', count: contactCount }
  }

  let storylineRules
  try {
    storylineRules = await fs.readFile(path.join(paths.dataDir, 'plays', 'storyline.md'), 'utf8')
  } catch {
    throw err('no-rules', 'data/plays/storyline.md missing')
  }

  let anthropic
  try {
    anthropic = await getClient()
  } catch {
    throw err('no-key', 'Anthropic API key not set in the macOS Keychain')
  }

  const system = [
    { type: 'text', text: 'You build the account-level storyline layer described in the rules below — one narrative spine, one distinct chapter per contact, grounded ONLY in the dossier facts provided.' },
    { type: 'text', text: `STORYLINE RULES (data/plays/storyline.md):\n\n${storylineRules}` },
    { type: 'text', text: `ACCOUNT DOSSIER (JSON):\n${dossierText}` },
  ]
  const rosterBlock = roster
    ? `ENROLLED ROSTER — THIS IS THE CAST (from Groove; these are the people Declan is actually messaging):\n${JSON.stringify(roster, null, 1)}\n\n` +
      `Rules for the roster, which OVERRIDE contract rule 1:\n` +
      `- Build one cast entry per person in this roster, using their name/title/email/sfdc_id exactly as given. These titles are Groove's live values — prefer them over any title in the dossier.\n` +
      `- Do NOT add cast members from the dossier's icp_contacts who are not in this roster; they are not being messaged, and contacts a brief run discovered are unconfirmed (they cannot appear in copy at all).\n` +
      `- Assign each person a genuinely distinct chapter_angle for what THEY own, derived from their title. Two marketing titles at one account still get different angles — e.g. demand gen owns pipeline/signal, product marketing owns category and comparison, an operations title owns routing and data, a founder/C-level owns ownership-routing only.\n` +
      `- If the dossier is thin, a chapter_angle may be grounded in the ROLE plus one real dossier fact rather than a unique fact per person. Never invent a fact to give someone a distinct angle; distinctness comes from the seat, the fact comes from the dossier.\n\n`
    : ''
  const userPayload = `Build the storyline for slug "${slug}", account "${dossier.name ?? slug}". Today's date: ${today()}.\n\n${rosterBlock}${CONTRACT}`

  // Explicit thinking/effort control, same as draft.js — without it this
  // model spends the whole max_tokens budget on adaptive reasoning before
  // emitting any text (seen 2026-09-01: stop_reason "max_tokens", 0 output
  // chars, on a bare max_tokens: 4000 call). "medium" effort matches
  // draft.js's kind=next budget — this task is comparable synthesis work,
  // just structured data instead of prose, so it doesn't need "high".
  const attempt = async () =>
    anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      system,
      messages: [{ role: 'user', content: userPayload }],
    })

  let msg
  try {
    msg = await attempt()
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) {
      invalidateClient()
      throw err('auth', 'Anthropic API key was rejected — update the Keychain entry and retry.')
    }
    throw err('api', e.message ?? 'storyline build failed')
  }
  if (msg.stop_reason === 'refusal') throw err('refused', 'Claude declined to build this storyline.')

  const textOf = (m) => m.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
  const parse = (text) => {
    const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
    const start = stripped.indexOf('{')
    const end = stripped.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(stripped.slice(start, end + 1))
    } catch {
      return null
    }
  }

  let text = textOf(msg)
  let storyline = parse(text)
  if (!storyline) {
    // One retry, same pattern as draft.js — an occasional non-JSON emission
    // usually parses clean on a fresh attempt.
    const retry = await attempt()
    if (retry.stop_reason !== 'refusal') {
      text = textOf(retry)
      storyline = parse(text)
    }
  }
  if (!storyline) {
    console.warn(`[storylineBuilder] unparseable for ${slug} — stop_reason: ${msg.stop_reason}, text length: ${text.length}`)
    throw err('unparseable', 'storyline response was not valid JSON after one retry')
  }

  storyline.generated_by = 'auto-storyline-builder'
  storyline.reviewed = false
  storyline.created = today()
  storyline.slug = slug

  const validate = await getValidator()
  if (!validate(storyline)) {
    throw err('invalid', `generated storyline failed schema validation: ${JSON.stringify(validate.errors?.slice(0, 3))}`)
  }

  const tmp = `${outFile}.sb-tmp.json`
  await fs.writeFile(tmp, JSON.stringify(storyline, null, 2) + '\n')
  await fs.rename(tmp, outFile)

  return { built: true, cast_count: storyline.cast.length, spine: storyline.spine, generated_at: nowIso() }
}
