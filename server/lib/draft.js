// Drafting engine (send-desk v1) — real messaging per tracker contact, not
// just a hook. Grounded on: the contact row + persona map, the account
// dossier (when researched), the Groove mirror's touch history, the plays
// library (data/plays/*.md incl. the verified stats library), and the
// account's tracker flags. Same client/proxy/Keychain key as chat; no MCPs.
//
// Two kinds:
//   pack — enrollment pack for the variable-driven Groove flow: email1/2/3 +
//          LinkedIn InMail + call talking points, written as a coherent set
//          (each message aware of the ones before it).
//   next — ONE next-step message continuing the existing thread, using the
//          mirror's touch history for what's already been sent.
import fs from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { config, paths } from './config.js'
import { getClient, invalidateClient, CHAT_MODEL, KEYCHAIN_SERVICE } from './chat.js'
import { readStore } from './trackerStore.js'
// Shared with the account page's Storyline card (GET /api/storyline/:accountId)
// so the UI and the draft engine resolve the same file for an account.
import { loadStoryline } from './storyline.js'
import { resolveIndexSlug } from './accountSlug.js'
import { personas } from '../../data/personas.js'

const MODEL = config.draft?.model ?? CHAT_MODEL
// Models a caller may request per-request (the tier A/B). Fable is deliberately
// absent — CLAUDE.md: it is never selected anywhere in this app.
const DRAFT_MODEL_ALLOWLIST = ['claude-opus-5', 'claude-opus-4-8', 'claude-sonnet-5', 'claude-haiku-4-5']
// Adaptive thinking spends from the same budget as the text — a pack that
// deserves real thought needs real headroom (8000 truncated mid-JSON).
//
// Next-step drafts are a different shape entirely and get their own, much
// tighter ceiling (2026-09-03 spend review). They are ~100% of the morning
// batch — 208 calls every weekday — and each was burning ~2,788 output
// tokens to produce a <=100-word email, which made output 65% of the whole
// draft bill. Because adaptive thinking spends from the same budget as the
// text, capping tokens bounds the thinking too. That is deliberately the
// lever used here instead of dropping `effort` to 'low', which was tried on
// 2026-08-12 and regressed both the gates self-scorecard and per-account
// angle diversity (see the effort comment in handleDraft).
const MAX_TOKENS_PACK = config.draft?.max_tokens_pack ?? config.draft?.max_tokens ?? 16000
const MAX_TOKENS_NEXT = config.draft?.max_tokens_next ?? 3000

const SYSTEM = `You draft outbound messaging for Declan Jackman, a BDR on G2's Mid-Market team. You write AS Declan, in his voice: short, direct, curious, peer-to-peer, zero fluff. Lowercase subjects, ultra-short and specific. EVERY email leads with the reader's own context — the first sentence is always a real fact about THEIR world, never about Declan or G2. On a genuinely first-ever touch (no prior touches on record — see anatomy.md's Email 1 rule) the self-introduction goes at the BACK, as the last line before the signature ("Nice to meet you either way. Declan here from G2, {AE} and I cover {company}'s account."); once a real thread exists, skip re-introducing himself entirely. One proof point per message tied to one outcome for the reader's role. Email CTAs ask for interest, not time ("open to seeing what the model returned?" — anatomy.md's CTA section), and first touches use observation/curiosity framing rather than a diagnosis-plus-fix pitch — never sound like a template or use corporate filler.

Hard rules — violating any of these makes the output unusable:
1. Stats: this restricts ONLY industry/research statistics (the 2026 Buyer Behavior Report, GenAI-adoption figures, etc.) — use those ONLY from the provided stats library with status "canonical", in their canonical wording; never invent numbers, never use "needs-source" stats, never use another account's account-specific numbers. It does NOT restrict dossier facts (this account's own review count/rating/recency, a named competitor's review count, a dated news/hiring item, CRM history, this account's own g2.buyer_intent numbers) — those are sourced data, not "stats library" stats, and rule 15 below governs when to reach for them instead.
2. Never mention or imply 6sense data, intent scores, or "noticed you've been researching".
3. Never name specific companies as "researching you/your category" — that claim requires seller-console data Declan attaches manually.
4. ai_visibility honesty: if the dossier shows the company DOES appear in LLM answers, do not claim absence — flip to "you're in the answer today; the inputs that keep you there are the part worth managing".
5. Dossier facts flagged unverified_estimate or contacts marked unconfirmed do not appear in copy.
6. Exemplars in the plays are voice references — never reuse their sentences verbatim.
7. If the account has flags (e.g. "sync w/ Sean — Nick owns in SFDC"), repeat them in flag_warnings so Declan sees them before sending. Do not soften them.
8. Do not invent facts about the company. If the dossier is missing (unresearched account), write from the play + persona + stats only, and say so in the rationale.
9. C-suite/founder/president contacts (executive persona, or any C-level/founder/president title): the CTA is ALWAYS an ownership-routing question ("who owns your G2 presence today — you, or someone on the team?") and NEVER a time/meeting ask — no "20 minutes", no "worth a call", no calendar link, on ANY channel: email CTA, InMail close, and voicemail sign-off alike. Getting forwarded or given a name is the win. VPs are exempt (they usually own it) — this rule is strictly C-level/founder/president.
10. Never undercut G2 in copy. Never state or imply that G2 was absent from an AI answer's source/citation mix, that LLMs don't draw on G2, or that the prospect is doing fine — the source mix of a single ai_visibility answer is diagnostic data, not prospect-facing material. When a head-to-head shows the company holding its own, the angle is the inputs that keep it that way (review recency/volume, profile ownership) — reassurance is not a message, and "shortlist gap vs sourcing gap" analysis stays out of emails. Honesty rule 4 still holds: never claim absence that isn't there; select which true facts serve the wedge.
11. Data-window honesty: when citing buyer-intent aggregates or any time-boxed count, state the window plainly and never juxtapose a partial period against a full one as a trend ("went from 521 in July to 359 in the first 4 days of August" reads as a decline and misstates the math — real trend claims need same-length windows; when windows differ, present one number with its window and stop). Check the data's retrieved_at: a partial-month figure from a week-old pull is stale the day it's sent — prefer the durable total ("847 companies since July 1"). And NEVER assert what the prospect's team currently does or doesn't do internally (scoring, routing, targeting, process) — "none of that gets routed anywhere" is an invented fact about their stack; frame it as a genuine question instead.
12. gates.md in the library governs voice and framing for EVERY message: the reader's six mental gates, the we-we rule (≤2 self-references per body, excluding the back-of-email self-intro and signature; G2 facts about THEM are allowed, G2-as-us is banned from the body), preview-text-about-them (the first 50 characters are the reader's fact, never our introduction), problem-prompter framing, seek-to-be-corrected tonality, and SAY IT POSITIVE. Two banned figures, every channel (email, InMail, DM, voicemail script): (a) LITOTES — asserting a thing by negating its opposite ("not uncommon", "no small feat", "not the worst", "hardly surprising", "isn't nothing"); (b) CONTRASTIVE NEGATION — the "it's not X, it's Y" / "not just X, but Y" / "X isn't A anymore, it's B" shape; write the Y half alone ("the page's primary reader is a model now", never "the page's primary reader isn't a buyer anymore, it's a model"). Both read as machine-written and spend words the reader is not giving you. Genuine hypotheses ("not sure if X…") and true negative facts ("almost none of them ever see you") are unaffected and stay. (c) ABSTRACTION AS ACTOR (2026-08-26) — a sentence whose subject is an abstract noun doing something: "that's the language forming your category story before your team gets a say in it". The reduced-relative grammar is fine; the nouns are the problem. Test every body sentence: can the reader POINT at its subject? A page, a review count, a date, a job posting, a competitor, a person — pointable, keep. "The language", "the story", "the signal", "the conversation", "the narrative", "the shift" acting on another abstraction — rewrite by naming who or what actually acts ("Claude describes you from a category page last updated in 2024. Nobody on your team wrote that description."), or cut the sentence. Reduced relatives on CONCRETE nouns ("the 12 reviews sitting on your profile") and companies-as-agents ("G2 sends them elsewhere") are unaffected and stay. Exemplars quoted in the plays library predate this rule — mine them for angle, never copy their sentence shape. Every email/InMail/DM object in your output MUST carry a "scorecard" field per gates.md ({"self_refs": N, "failed_gates": [...], "time_ask": bool}). A draft failing gate 1 (pitch) or gate 2 (about us) is rewritten before output, not scored and shipped.
13. If CONTACT.connected is true: for a NEXT draft with channel "linkedin", regardless of Activity-1-vs-2+ step number, do NOT write a text DM. Instead write a short voice-note/video talking-point script: 3-5 short spoken beats, natural language (not written prose), ending on a light open question, no meeting ask. Say so plainly in the rationale ("recorded voice-note/video, not a text DM — already connected"). This overrides the Activity-1/2 text-length and structure rules below for this contact.
14. Packs (kind=pack) never generate LinkedIn/InMail copy — that channel is drafted on-demand only when a real Groove flow step calls for it (kind=next with a LinkedIn/InMail dueStep). Generating it speculatively on every enrollment pack wastes model spend on copy nobody sends (Declan, 2026-08-31).
15. **Dossier-fact priority (2026-09-01 — batches were reaching for generic stats while dossier-specific ammunition sat unused).** When a dossier is provided, READ its messaging.angles, g2.presence_summary, news, hiring, signals, and the contact's own icp_contacts[].why_icp in full before choosing a play or a stat. **messaging.angles is the account's pre-worked anchor list** — each entry is an angle plus a "grounded_in" field naming the dossier fields it came from. Start there: pick the ONE angle that fits this contact's seat, verify its "grounded_in" facts are still present in the dossier, and build from it. Different contacts at the same account MUST take different angles from that list — that list existing is why the account has more than one story. Reach past it only when no angle fits this person's role, and say so in the rationale. A canonical stat (bbr-stat or any play's built-in "Angle" stat) is the FALLBACK for accounts with no dossier or where nothing in the dossier is persona-relevant to this contact — it is never the default just because it's less work than reading the dossier. If the dossier contains a specific, current fact that makes the same point as a canonical stat would (this account's own review count/rating/recency vs. a named rival's, a dated news/hiring item, this contact's own recorded history with G2 per CRM/Gong notes, this account's own g2.buyer_intent numbers), use THAT fact instead of the canonical stat, named and dated. bbr-stat is the right play ONLY when no such fact exists for this contact. A "next" draft for an account WITH a dossier that cites zero dossier-specific facts is a failure mode — say in the rationale which specific dossier field(s) you checked and why none applied, don't silently default to a generic stat.

Choose the best play from the library using its trigger table (winback beats generic if CRM history shows churn; aeo-screenshot needs an ai_visibility result; etc.), but rule 15 governs which FACT fills it — prefer the dossier's own specific data over a play file's built-in exemplar stat wherever both would make the same point. Personalize from dossier facts: top_signal, ai_visibility results, news, hiring, G2 review counts, CRM history.

STRUCTURE is governed by anatomy.md in the library: compose each email from its slots (BRIDGE from a real event or Tier-1 closed-lost context only; ONE HOOK; SOCIAL PROOF only with real named-competitor data, else skip), persona routing adjusts expression, CTA comes from the by-role table (never "15-minute call"), and the per-message word/character limits are hard limits. Loss reasons route tone but never appear in copy.

Output STRICT JSON only — no markdown fences, no commentary outside the JSON.`

const PACK_CONTRACT = `Return JSON:
{
  "play": "<play name>",
  "rationale": "<2-3 sentences: why this play, which account facts you used>",
  "flag_warnings": ["<any account flags, verbatim>"],
  "emails": [
    {"slot": "email1", "subject": "...", "subject_b": "<A/B variant>", "body": "...", "scorecard": {"self_refs": 0, "failed_gates": [], "time_ask": false}},
    {"slot": "email2", "subject": "...", "body": "...", "scorecard": {...}},
    {"slot": "email3", "subject": "...", "body": "...", "scorecard": {...}}
  ],
  "call_points": ["<3-5 bullet talking points for the flow's call steps>"]
}
The three emails are Days 1/7/14 of the flow and must follow anatomy.md exactly: every email <=100 words (60-90 is the sweet spot — less is more); email1 = first-ever-touch opener: the Problem Prompter skeleton leads with THEIR context per anatomy.md's Email 1 rule (Saw THIS -> not-sure-if-PROBLEM as a genuine curiosity question, never a diagnosis-plus-fix -> evidence/peer story -> interest ask, never a time ask -> self-intro + either-way close as the LAST line before the signature, never the first) — the DEFAULT shape, departures allowed when the situation calls for it but named in the rationale; email2 = NEW angle with a brief callback to email1, Problem Prompter core (new problem facet -> new evidence -> interest ask); email3 = permission-to-close 40-70 words, no calendar link, one async value item, easy to say no. Never repeat a proof point across emails. Bodies are plain prose, line breaks as \\n, no HTML, no bullets.`

const NEXT_CONTRACT = `Return JSON:
{
  "play": "<play name>",
  "rationale": "<2-3 sentences: why this message now, what the thread history shows>",
  "flag_warnings": ["<any account flags, verbatim>"],
  "channel": "email" | "linkedin" | "call",
  "subject": "<subject, or null for linkedin/call>",
  "body": "<the message (voicemail script or call talking points if channel=call), plain text>",
  "scorecard": {"self_refs": 0, "failed_gates": [], "time_ask": false}
}
Thread continuity governs WHAT you say (hard rules below), never how the message opens: Groove sends every email step as a brand-NEW email in a new thread, not a reply. An email draft must stand alone — fresh specific subject, an opener that works even if they never opened the earlier sends, no "Following up" / "circling back" / references to "my last note" or "the thread". If the contact replied, this is a reply-handling message, not a cold touch.

If channel is "linkedin": follow the "LinkedIn flow touches" rules in anatomy.md exactly — the step NUMBER decides which kind. "Linkedin Activity 1" (or an unnumbered LinkedIn step) = quick relevant touch (1-2 sentences, ≤300 characters, no stats/proof points/meeting asks, calibrated to who this person is) and is exempt from the new-proof-point rule below — it adds presence, not proof. "Linkedin Activity 2" or higher = VALUE-ADD touch (2-4 sentences, ≤500 characters): ONE new proof point, competitor-led when real dossier compare/review data meets the competitor-naming criteria (else the next-best grounded facet — never an invented competitor, never a bare check-in), closing on an open question tied to the fact — no links, no meeting ask. That proof point counts toward thread continuity like any email's.

If channel is "call": follow anatomy.md exactly. A VM step ("VM"/"voicemail" in the step name) gets a full SPOKEN voicemail script (75-110 words): signal open (never your name first), a stakes line that creates real urgency from a moving fact, ONE value line, CTA pointing at the companion email or asking plainly for the callback. A live-call step gets 3-5 talking points, then "---" and a compressed no-answer voicemail fallback. Short generic voicemails with no stakes are rejected work.

THREAD CONTINUITY — hard rules:
- Read the BODIES of prior outbound touches in the history. The value thread they establish for this persona (e.g. "intent signal -> CRM -> scoring/routing" for RevOps) is THE thread. Your message deepens it with a NEW proof point or facet — it never re-pitches the same point and never pivots to a different value story mid-sequence. Two unrelated pitches in one thread read like two different vendors.
- The angle must fit THIS contact's persona and what they own. An account-level play (e.g. AEO) only enters the thread if it can be expressed in this persona's terms; otherwise it belongs to a different contact at the account.
- Pivot to a different play/angle ONLY when: the contact replied and steered elsewhere, or prior touch bodies are unavailable (subjects alone are not a thread). When you do pivot, say why in the rationale.`

async function loadPlaysLibrary() {
  const dir = path.join(paths.dataDir, 'plays')
  try {
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.md')).sort()
    const parts = []
    for (const f of files) {
      parts.push(`--- ${f} ---\n${await fs.readFile(path.join(dir, f), 'utf8')}`)
    }
    return parts.join('\n\n')
  } catch {
    return null
  }
}

async function readDossierFile(slug) {
  const file = path.join(paths.accountsDir, `${slug}.json`)
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

// ~40% of a dossier's bytes are never referenced by this prompt (measured
// across the 106 real dossiers, 2026-09-03): `messaging`, `discrepancies`,
// `sources_missing`, `corrections_applied`, the top-level `intent` block
// (the prompt uses `g2.buyer_intent`, a different field), most of
// `firmographics`, and every contact's `sources` array. On a median 42 KB
// dossier that is ~17 KB of dead context on every one of ~208 calls a day.
//
// What stays is everything the SYSTEM rules actually name: g2, news, hiring,
// signals, salesforce, gong, ai_visibility, community, and the full
// icp_contacts list (colleague awareness depends on seeing every contact,
// not just the one being drafted). `verification` collapses to its status
// because hard rule 5 only needs the unconfirmed flag, not the audit trail.
//
// Any parse failure falls back to the raw file — a slimming bug must never
// silently strip an account's research down to nothing.
function slimDossier(text) {
  if (config.draft?.slim_dossier === false) return text
  try {
    const d = JSON.parse(text)
    // `messaging.angles` goes back in (2026-09-08). Dropping the whole
    // `messaging` block on 2026-09-03 was measured as ~9% of dossier bytes, but
    // those bytes were the per-persona anchor layer: 468 angles across 106
    // dossiers, each carrying a `grounded_in` field naming the exact dossier
    // fields it was derived from, several already assigned to a named contact.
    // Deep-run research produced them; stripping them made every draft
    // re-derive an angle from raw sections at effort "medium", and five
    // colleagues at one account converge on whichever fact is loudest. That is
    // the single cheapest quality lever available: ~2 KB, inside the
    // cache_control block (so it bills at cache-read rates on repeat drafts for
    // the same account, which account-grouped batching already guarantees).
    //
    // `openers` stays out on purpose — finished prose invites verbatim reuse,
    // and gates.md is explicit that exemplars are voice references only. Angles
    // are raw material; openers are someone else's draft.
    if (d.messaging && typeof d.messaging === 'object') {
      const angles = d.messaging.angles
      if (Array.isArray(angles) && angles.length) d.messaging = { angles }
      else delete d.messaging
    }
    delete d.discrepancies
    delete d.sources_missing
    delete d.corrections_applied
    delete d.intent
    if (d.firmographics && typeof d.firmographics === 'object') {
      d.firmographics = { categories: d.firmographics.categories ?? [] }
    }
    if (Array.isArray(d.icp_contacts)) {
      d.icp_contacts = d.icp_contacts.map((c) => {
        const { sources, verification, ...rest } = c
        return verification?.status ? { ...rest, verification: { status: verification.status } } : rest
      })
    }
    return JSON.stringify(d)
  } catch {
    return text
  }
}

// Tracker account ids are supposed to be research-index slugs, but rows
// created from Groove account names can drift (e.g. "spreedly" vs the
// dossier's "spreedly-com") — without this fallback the draft silently
// loses ALL research and writes from play + persona + stats alone.
async function loadDossier(slug, accountName) {
  const direct = await readDossierFile(slug)
  if (direct) return slimDossier(direct)
  if (!accountName) return null
  const indexSlug = await resolveIndexSlug(accountName)
  if (!indexSlug) {
    // Loud enough to act on: a name that resolves to nothing is either a real
    // un-researched account or an alias missing from data/account-aliases.json,
    // and the two are indistinguishable in the draft output itself.
    console.warn(`[draft] no research-index slug for account "${accountName}" (tracker id "${slug}") — drafting without a dossier`)
    return null
  }
  const text = await readDossierFile(indexSlug)
  return text ? slimDossier(text) : null
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

// Messages marked "sent" on the Due page are real outbound touches the Groove
// mirror won't show until the next outreach sync — scan the recent day files
// so the next draft continues the thread instead of re-pitching what just
// went out. Newest first, capped small (the prompt only needs the recent tail).
async function loadDashboardSent(contactId, { files = 14, max = 6 } = {}) {
  const dir = path.join(paths.dataDir, 'drafts')
  let names
  try {
    names = (await fs.readdir(dir))
      .filter((f) => /^due-\d{4}-\d{2}-\d{2}\.json$/.test(f))
      .sort()
      .reverse()
      .slice(0, files)
  } catch {
    return []
  }
  const sent = []
  for (const name of names) {
    try {
      const day = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))
      for (const e of day.drafts ?? []) {
        if (e.contactId === contactId && e.sentAt && e.draft) {
          sent.push({
            sent_at: e.sentAt,
            step: e.step ?? null,
            play: e.draft.play ?? null,
            channel: e.draft.channel ?? null,
            subject: e.draft.subject ?? null,
            body: (e.draft.body ?? '').slice(0, 700),
          })
        }
      }
    } catch {
      /* unreadable day file — skip */
    }
  }
  return sent.sort((a, b) => (a.sent_at < b.sent_at ? 1 : -1)).slice(0, max)
}

// Cross-day colleague memory (2026-09-08). batchContext already stops two
// colleagues getting near-identical openers on the SAME day, but it lives only
// inside one batch run — so Thursday's draft for Bob had no idea what Tuesday's
// draft for Sarah at the same account said, and the whole account's messaging
// drifted back onto the one or two strongest facts. This walks the recent day
// files for OTHER contacts at this account.
//
// Deliberately reports `sent` per entry rather than filtering on it. Marking a
// draft sent on the Due page is the only signal we have and it is set on ~1% of
// entries (31 of ~2,900 through 2026-09-08), so filtering on it would return
// nothing. The block is therefore scoped to what needs no send confirmation:
// DON'T REPEAT this angle. Whether a draft may say "I sent this to Sarah" is a
// different question and stays where it belongs — storyline.md's pairings and
// claims_ledger — because an unsent draft is not a touch and asserting one
// would invent a relationship (the claims-ledger rule).
async function loadColleagueDrafts(accountId, selfContactId, { files = 10, max = 8 } = {}) {
  if (!accountId) return []
  const dir = path.join(paths.dataDir, 'drafts')
  let names
  try {
    names = (await fs.readdir(dir))
      .filter((f) => /^due-\d{4}-\d{2}-\d{2}\.json$/.test(f)) // .bak files excluded by the anchor
      .sort()
      .reverse()
      .slice(0, files)
  } catch {
    return []
  }
  const out = []
  for (const name of names) {
    let day
    try {
      day = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'))
    } catch {
      continue
    }
    for (const e of day.drafts ?? []) {
      if (e.accountId !== accountId || e.contactId === selfContactId || !e.draft) continue
      out.push({
        date: day.date ?? name.slice(4, 14),
        colleague: e.name ?? null,
        step: e.step ?? null,
        channel: e.draft.channel ?? null,
        play: e.draft.play ?? null,
        subject: e.draft.subject ?? null,
        opener: (e.draft.body ?? '').split('\n').filter(Boolean)[1]?.slice(0, 180) ?? null,
        sent: Boolean(e.sentAt),
      })
    }
  }
  // Newest first, and cap — the prompt needs the recent shape of the account's
  // messaging, not its whole history.
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, max)
}

// Best-effort JSON extraction — models occasionally wrap in fences despite
// instructions. Returns null when unparseable (caller falls back to raw text).
function parseJson(text) {
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

export async function handleDraft(req, res) {
  const { contactId, kind, dueStep, batchContext, model: modelOverride } = req.body ?? {}
  if (typeof contactId !== 'string' || !contactId) {
    return res.status(400).json({ error: 'contactId is required' })
  }
  if (kind !== 'pack' && kind !== 'next') {
    return res.status(400).json({ error: 'kind must be "pack" or "next"' })
  }
  if (dueStep != null && typeof dueStep !== 'string') {
    return res.status(400).json({ error: 'dueStep must be a string' })
  }
  if (batchContext != null && typeof batchContext !== 'string') {
    return res.status(400).json({ error: 'batchContext must be a string' })
  }
  // Per-request model, for the tier A/B (scripts/draft-ab.js). Allowlisted
  // rather than free-form: this endpoint is reachable from the dashboard, and
  // an arbitrary string here would be a way to bill an unintended model.
  // config.draft.model / config.chat.model remain the default for every
  // ordinary draft — nothing changes unless a caller asks.
  if (modelOverride != null && !DRAFT_MODEL_ALLOWLIST.includes(modelOverride)) {
    return res.status(400).json({ error: `model must be one of ${DRAFT_MODEL_ALLOWLIST.join(', ')}` })
  }

  const store = await readStore()
  const contact = store.contacts.find((c) => c.id === contactId)
  if (!contact) return res.status(404).json({ error: 'no such contact' })
  const account = store.accounts.find((a) => a.id === contact.accountId) ?? null

  const [plays, dossier, storyline, mirror, sentDrafts, colleagueDrafts] = await Promise.all([
    loadPlaysLibrary(),
    loadDossier(contact.accountId, account?.name),
    loadStoryline(contact.accountId, account?.name),
    loadMirrorEntry(contact),
    loadDashboardSent(contactId),
    loadColleagueDrafts(contact.accountId, contactId),
  ])
  if (!plays) return res.status(503).json({ error: 'plays library missing — expected data/plays/*.md' })

  let anthropic
  try {
    anthropic = await getClient()
  } catch {
    return res.status(503).json({
      error:
        'Anthropic API key not set. Add it to the macOS Keychain: ' +
        `security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w`,
    })
  }

  // Packs think deeply (14 days of touches ride on them); next-step drafts run
  // at medium effort — low proved too generous on the gates self-scorecard
  // (2026-08-12 batch: four drafts self-scored ≤2 self-refs that counted 3-4)
  // and too lazy on per-account angle diversity.
  const effort = kind === 'next' ? 'medium' : 'high'

  const personaEntry = contact.persona ? personas[contact.persona] : null
  // Computed here, not left for the model to infer from raw JSON: a step's
  // day-number in the flow name (e.g. "Day 10 - ... Email 4") says nothing
  // about whether Declan has actually sent this contact anything before —
  // Groove flows get exported/re-enrolled and the mirror can show zero
  // touches on a "late" step. Tone (self-intro, no cost-of-waiting CTA)
  // hinges on real prior contact, so it's decided in code and stated as a
  // flat fact, not buried inside a long paragraph for the model to parse.
  // A bare LinkedIn connection request ("LinkedIn Connect: >> ...") is a
  // networking action, not a message — it shouldn't disqualify a contact
  // from the first-ever-touch treatment when their first real email/call/DM
  // is the one being drafted now.
  const realPriorTouches = (mirror?.touches ?? []).filter(
    (t) => !(t.channel === 'linkedin' && /connect/i.test(t.subject ?? ''))
  )
  const hasPriorTouches = realPriorTouches.length > 0 || Boolean(mirror?.replied) || sentDrafts.length > 0
  const userPayload = [
    `TASK: draft a ${kind === 'pack' ? 'flow enrollment pack' : 'single next-step message'} for the contact below.`,
    `CONTACT: ${JSON.stringify({ name: contact.name, title: contact.title, persona: contact.persona, step: contact.step, hook: contact.hook || null, status: contact.status, nextAction: contact.nextAction, connected: Boolean(contact.connected) })}`,
    hasPriorTouches
      ? 'FIRST-EVER TOUCH: NO — real prior touches exist (see GROOVE TOUCH HISTORY / SENT FROM DASHBOARD below). Do not re-introduce Declan. The cost-of-waiting CTA framing in anatomy.md is fair game (email/call channels only — see the CONNECTED LINKEDIN directive below if this contact is LinkedIn-connected, which overrides channel choice).'
      : contact.connected
        ? 'FIRST-EVER TOUCH: YES, but this contact is LinkedIn-connected — see the CONNECTED LINKEDIN directive below, which governs both channel and template for this message instead of the email Email-1 template.'
        : `FIRST-EVER TOUCH: YES — no prior touches exist for this contact ANYWHERE (Groove mirror shows none, nothing marked sent from this dashboard), regardless of what day-number or email-number the due step's name carries. LEAD WITH THEIR CONTEXT: the first sentence after a bare greeting ("Hi ${contact.name?.split(' ')[0] ?? '{FirstName}'},") is a real fact about THEIR world, so it lands inside the 50-character preview window. The self-introduction goes at the BACK as the last line before the signature, per anatomy.md's Email 1 rule, near-verbatim: "Nice to meet you either way. Declan here from G2${account?.aeOwner ? `, ${account.aeOwner} and I cover ${account?.name ?? 'their'}'s account."` : `, I cover ${account?.name ?? 'their'}'s account."`} NEVER open the email with that introduction. Land the real fact/stakes as an observation or genuine curiosity question — NEVER a diagnosis-plus-fix ("here's what's broken", "worth fixing before X", "what's fixable"). Do NOT use cost-of-waiting phrasing ("before another quarter goes by", "worth it before X happens") on this message — that framing is reserved for contacts with real prior touches.`,
    ...(contact.connected
      ? [
          !hasPriorTouches
            ? `CONNECTED LINKEDIN (this OVERRIDES every other channel/template instruction in this prompt, including FIRST-EVER TOUCH and DUE TODAY below): channel MUST be "linkedin" — never email, never call, regardless of what the due step's name says. This is a voice-note/video script, not a text DM. Follow anatomy.md's "Fresh-connection voice note" template EXACTLY, in order: (1) "Hey, first off, just want to say thanks for connecting" + a genuine day-of-week nod if it naturally fits; (2) "I was assigned as your G2 profile advisor" (or "...for ${account?.name ?? 'their company'}"); (3) ONE relevant value nugget stated as a fact, never framed as "here's why this matters to you" — a real named competitor outperforming them on G2/AEO when the naming-competitors criteria are met, else the next-best grounded persona-fit fact, else skip this step entirely rather than force one; (4) close near-verbatim: "regardless, thanks for connecting — have a great [day-part]." No meeting ask anywhere. Write it as spoken words (3-5 short beats), not written prose.`
            : `CONNECTED LINKEDIN (this OVERRIDES every other channel/template instruction in this prompt, including FIRST-EVER TOUCH and DUE TODAY below): channel MUST be "linkedin" — never email, never call, regardless of what the due step's name says or how much prior email/call history exists. This is a voice-note/video script, not a text DM (anatomy.md's "Already connected on LinkedIn" rule) — 3-5 short spoken beats, natural spoken language, ONE new fact/angle not yet used in the email thread, ending on a light open question, no meeting ask.`,
        ]
      : []),
    ...(dueStep
      ? [`DUE TODAY (Groove flow step): ${dueStep.slice(0, 200)} — draft the message for THIS step. If the step is an email step ("Send email"/"Send email template"), channel MUST be "email" and the draft is a brand-NEW standalone email advancing a NEW facet of the thread — never a reply, never a repeat of a prior proof point. NEVER assume a step is the flow's last email: "closing the loop"/permission-to-close framing is allowed ONLY when the step name itself marks it ("break up", "final", "close") — a day number, even a high one, is not that signal; email structure follows anatomy.md's Problem Prompter section — full skeleton when prior outbound is only flow templates (a template send does not use up the first real email), core (problem facet -> evidence -> interest ask) once the thread carries a custom email; it is the default, not a mandate — name any departure in the rationale. If the step name contains "Thought Leadership", channel MUST be "linkedin" and this follows the "LinkedIn Thought Leadership Share" section of anatomy.md exactly — a pure value-add content share (one real external article/industry angle, zero G2 content, zero proof point, zero play, no ask) — do NOT apply a play from the plays library to this step. If it is any other LinkedIn step ("Linkedin Activity", "InMail"), channel MUST be "linkedin" — "Activity 1" is a quick relevant touch per anatomy.md; "Activity 2" or higher is a value-add touch per anatomy.md (one new proof point, competitor-led when the data qualifies). If it is a VM step ("VM"/"voicemail" in the name), channel MUST be "call" and the body MUST be a full spoken voicemail script per anatomy.md's "Voicemail scripts" section — signal open, real-stakes urgency line, one value line, email/callback CTA — never bullet talking points. Any other call step ("Cold Call") is a live-dial step: talking points + the no-answer voicemail fallback per anatomy.md.`]
      : []),
    ...(colleagueDrafts.length
      ? [
          `EARLIER MESSAGING TO COLLEAGUES AT THIS ACCOUNT (previous days, newest first). Colleagues compare inboxes, so the account's messaging has to keep moving:\n${JSON.stringify(colleagueDrafts)}\n` +
            `Use this ONLY to stay off ground already covered: do not reuse these subjects, opening lines, hook framings, opener mechanics, or proof points for THIS person — pick a different facet and tie it to what THIS person owns.\n` +
            `Do NOT reference any of these messages in your copy. "sent": false means the draft was written but never confirmed sent, and even a true one only licenses a reference through the storyline's pairings/claims_ledger — never assert a touch to a colleague from this block.`,
        ]
      : []),
    ...(batchContext
      ? [`ALREADY DRAFTED for colleagues at this account today — assume they forward and compare emails:\n${batchContext.slice(0, 4000)}\nHard requirement: do NOT reuse any of these subjects, opening lines, hook framings, or opener MECHANICS. A mechanic is the move itself, not the wording — if a colleague's draft opens with "ran [question] through an AI/Claude", no other draft at this account may open with running any prompt through any model, however reworded; same for head-to-head comparisons, review-count observations, or news reactions. Take a genuinely different angle for THIS person: a different proof point, a different facet (head-to-head result vs category absence vs review-equity vs news/hiring), or the next-best grounded play — and tie it to THIS person's role. Near-identical emails across colleagues read as blast automation and burn the whole account.`]
      : []),
    personaEntry ? `PERSONA PROFILE (${contact.persona}): ${JSON.stringify(personaEntry)}` : 'PERSONA PROFILE: none assigned — infer carefully from the title, note it in the rationale.',
    `TRACKER ACCOUNT: ${JSON.stringify(account ?? { id: contact.accountId })}  (flags are coordination warnings — surface them)`,
    mirror
      ? `GROOVE TOUCH HISTORY (from Salesforce, newest first): ${JSON.stringify({ flow: mirror.flow, flow_day: mirror.flow_day, replied: mirror.replied, last_inbound: mirror.last_inbound, touches: mirror.touches.slice(0, 12) })}`
      : 'GROOVE TOUCH HISTORY: none on record — treat as a cold first touch.',
    ...(sentDrafts.length
      ? [`SENT FROM THIS DASHBOARD (Declan marked these sent on the Due page — real outbound touches to THIS contact that the Groove mirror may not show yet; newest first, treat as part of the thread and never repeat their proof points): ${JSON.stringify(sentDrafts)}`]
      : []),
    dossier ? 'The account research dossier is provided in the system context.' : 'NO DOSSIER: this account is unresearched — play + persona + canonical stats only; no invented company facts.',
    ...(storyline
      ? ['A STORYLINE exists for this account — chapter discipline, claim gates, and pairings in storyline.md are binding for this draft.']
      : []),
    kind === 'pack' ? PACK_CONTRACT : NEXT_CONTRACT,
  ].join('\n\n')

  // NDJSON stream (same shape as chat): {type:"delta",text} while the model
  // writes, then {type:"done", draft, raw?, usage} once the JSON is parsed.
  // The panel shows the text live and swaps to the structured view on done.
  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  })
  const send = (obj) => res.write(JSON.stringify(obj) + '\n')

  try {
    const params = {
      model: modelOverride ?? MODEL,
      max_tokens: kind === 'pack' ? MAX_TOKENS_PACK : MAX_TOKENS_NEXT,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system: [
        { type: 'text', text: SYSTEM },
        // Plays + stats change rarely — cache across drafts for any contact.
        { type: 'text', text: `PLAYS + STATS LIBRARY:\n\n${plays}`, cache_control: { type: 'ephemeral' } },
        ...(dossier
          ? [{ type: 'text', text: `Account research dossier (JSON):\n${dossier}`, cache_control: { type: 'ephemeral' } }]
          : []),
        ...(storyline
          ? [{ type: 'text', text: `Account STORYLINE (data/plays/storyline.md governs how to use this):\n${storyline}`, cache_control: { type: 'ephemeral' } }]
          : []),
        { type: 'text', text: `Today's date: ${new Date().toISOString().slice(0, 10)}` },
      ],
      messages: [{ role: 'user', content: userPayload }],
    }
    const textOf = (m) => m.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    // Only the first attempt streams: a retry's deltas would concatenate onto
    // the first attempt's text in the panel and read as garbage.
    const attempt = async ({ stream: streamDeltas }) => {
      const s = anthropic.messages.stream(params)
      if (streamDeltas) s.on('text', (delta) => send({ type: 'delta', text: delta }))
      return s.finalMessage()
    }

    const msg = await attempt({ stream: true })
    if (msg.stop_reason === 'refusal') {
      send({ type: 'error', error: 'Claude declined to draft this request.' })
    } else {
      let text = textOf(msg)
      let draft = parseJson(text)
      // input_tokens alone underreports the effective context by 10-20x once the
      // plays library + dossier are cached (2026-09-01) — cache_read/creation
      // tokens are real context the model read, just billed/reported separately.
      // Surfacing all three here means a low input_tokens number never reads as
      // "the rules weren't sent" when it's actually "the rules were cached."
      const addUsage = (into, u) => {
        into.input_tokens += u.input_tokens
        into.output_tokens += u.output_tokens
        into.cache_read_input_tokens += u.cache_read_input_tokens ?? 0
        into.cache_creation_input_tokens += u.cache_creation_input_tokens ?? 0
      }
      const usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
      addUsage(usage, msg.usage)
      // One retry on unparseable output. Seen 2026-08-24: the model emitted a
      // JS expression ("…".replace(…)) inside a JSON string value, which no
      // amount of extraction can recover — a fresh attempt usually parses.
      if (!draft) {
        console.warn(`[draft] unparseable JSON for ${contactId} (${kind}) — retrying once`)
        const retry = await attempt({ stream: false })
        addUsage(usage, retry.usage)
        if (retry.stop_reason !== 'refusal') {
          const retryText = textOf(retry)
          const retryDraft = parseJson(retryText)
          // Keep the retry's text as the fallback raw either way — it's the
          // attempt whose result is being reported.
          text = retryText
          draft = retryDraft
        }
        console.warn(`[draft] retry ${draft ? 'parsed' : 'also failed — falling back to raw text'}`)
      }
      send({
        type: 'done',
        contactId,
        kind,
        model: params.model, // the A/B needs to know which tier produced this
        draft,
        ...(draft ? {} : { raw: text }),
        usage,
      })
    }
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      invalidateClient()
      send({ type: 'error', error: 'Anthropic API key was rejected — update the Keychain entry and retry.' })
    } else {
      console.error('[draft] error:', err)
      send({ type: 'error', error: err.message ?? 'draft failed' })
    }
  } finally {
    res.end()
  }
}
