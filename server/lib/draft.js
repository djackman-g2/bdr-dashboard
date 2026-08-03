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
import { personas } from '../../data/personas.js'

const MODEL = config.draft?.model ?? CHAT_MODEL
// Adaptive thinking spends from the same budget as the text — a pack that
// deserves real thought needs real headroom (8000 truncated mid-JSON).
const MAX_TOKENS = config.draft?.max_tokens ?? 16000

const SYSTEM = `You draft outbound messaging for Declan Jackman, a BDR on G2's Mid-Market team. You write AS Declan, in his voice: short, direct, curious, peer-to-peer, zero fluff. Lowercase subjects, ultra-short and specific. First line establishes who he is and why THIS person ("Declan here from G2 — I cover {company}'s account"). One proof point per message tied to one outcome for the reader's role. Soft CTAs ("worth a quick meeting?"). Never sound like a template or use corporate filler.

Hard rules — violating any of these makes the output unusable:
1. Stats: use ONLY stats from the provided stats library with status "canonical", in their canonical wording. Never invent numbers, never use "needs-source" stats, never use another account's account-specific numbers.
2. Never mention or imply 6sense data, intent scores, or "noticed you've been researching".
3. Never name specific companies as "researching you/your category" — that claim requires seller-console data Declan attaches manually.
4. ai_visibility honesty: if the dossier shows the company DOES appear in LLM answers, do not claim absence — flip to "you're in the answer today; the inputs that keep you there are the part worth managing".
5. Dossier facts flagged unverified_estimate or contacts marked unconfirmed do not appear in copy.
6. Exemplars in the plays are voice references — never reuse their sentences verbatim.
7. If the account has flags (e.g. "sync w/ Sean — Nick owns in SFDC"), repeat them in flag_warnings so Declan sees them before sending. Do not soften them.
8. Do not invent facts about the company. If the dossier is missing (unresearched account), write from the play + persona + stats only, and say so in the rationale.
9. Never undercut G2 in copy. Never state or imply that G2 was absent from an AI answer's source/citation mix, that LLMs don't draw on G2, or that the prospect is doing fine — the source mix of a single ai_visibility answer is diagnostic data, not prospect-facing material. When a head-to-head shows the company holding its own, the angle is the inputs that keep it that way (review recency/volume, profile ownership) — reassurance is not a message, and "shortlist gap vs sourcing gap" analysis stays out of emails. Honesty rule 4 still holds: never claim absence that isn't there; select which true facts serve the wedge.

Choose the best play from the library using its trigger table (winback beats generic if CRM history shows churn; aeo-screenshot needs an ai_visibility result; etc.). Personalize from dossier facts: top_signal, ai_visibility results, news, hiring, G2 review counts, CRM history.

STRUCTURE is governed by anatomy.md in the library: compose each email from its slots (BRIDGE from a real event or Tier-1 closed-lost context only; ONE HOOK; SOCIAL PROOF only with real named-competitor data, else skip), persona routing adjusts expression, CTA comes from the by-role table (never "15-minute call"), and the per-message word/character limits are hard limits. Loss reasons route tone but never appear in copy.

Output STRICT JSON only — no markdown fences, no commentary outside the JSON.`

const PACK_CONTRACT = `Return JSON:
{
  "play": "<play name>",
  "rationale": "<2-3 sentences: why this play, which account facts you used>",
  "flag_warnings": ["<any account flags, verbatim>"],
  "emails": [
    {"slot": "email1", "subject": "...", "subject_b": "<A/B variant>", "body": "..."},
    {"slot": "email2", "subject": "...", "body": "..."},
    {"slot": "email3", "subject": "...", "body": "..."}
  ],
  "linkedin_inmail": "<InMail body, 300 CHARACTERS max, no links, no emojis>",
  "call_points": ["<3-5 bullet talking points for the flow's call steps>"]
}
The three emails are Days 1/7/14 of the flow and must follow anatomy.md exactly: every email <=100 words (60-90 is the sweet spot — less is more); email1 = opener (signal/scoop -> their challenge -> one G2 capability -> role CTA with the cost of waiting); email2 = NEW angle with a brief callback to email1, same CTA; email3 = permission-to-close 40-70 words, no calendar link, one async value item, easy to say no. CTAs on emails 1-2 carry FOMO grounded in a real moving fact per anatomy.md, never invented scarcity. Never repeat a proof point across emails. Bodies are plain prose, line breaks as \\n, no HTML, no bullets.`

const NEXT_CONTRACT = `Return JSON:
{
  "play": "<play name>",
  "rationale": "<2-3 sentences: why this message now, what the thread history shows>",
  "flag_warnings": ["<any account flags, verbatim>"],
  "channel": "email" | "linkedin" | "call",
  "subject": "<subject, or null for linkedin/call>",
  "body": "<the message (voicemail script or call talking points if channel=call), plain text>"
}
Thread continuity governs WHAT you say (hard rules below), never how the message opens: Groove sends every email step as a brand-NEW email in a new thread, not a reply. An email draft must stand alone — fresh specific subject, an opener that works even if they never opened the earlier sends, no "Following up" / "circling back" / references to "my last note" or "the thread". If the contact replied, this is a reply-handling message, not a cold touch.

If channel is "linkedin": this is a quick relevant touch, NOT a mini-email — follow the "LinkedIn flow touches" rules in anatomy.md exactly (1-2 sentences, ≤300 characters, no stats/proof points/meeting asks, calibrated to who this person is). LinkedIn touches are exempt from the new-proof-point rule below — they add presence, not proof.

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

async function loadDossier(slug) {
  const file = path.join(paths.accountsDir, `${slug}.json`)
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  try {
    return await fs.readFile(file, 'utf8')
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
  const { contactId, kind, dueStep, batchContext } = req.body ?? {}
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

  const store = await readStore()
  const contact = store.contacts.find((c) => c.id === contactId)
  if (!contact) return res.status(404).json({ error: 'no such contact' })
  const account = store.accounts.find((a) => a.id === contact.accountId) ?? null

  const [plays, dossier, mirror, sentDrafts] = await Promise.all([
    loadPlaysLibrary(),
    loadDossier(contact.accountId),
    loadMirrorEntry(contact),
    loadDashboardSent(contactId),
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
  // at low effort — adaptive thinking stays on (cheap, avoids the
  // disabled-thinking pitfalls) but spends far less, so responses land fast.
  const effort = kind === 'next' ? 'low' : 'high'

  const personaEntry = contact.persona ? personas[contact.persona] : null
  const userPayload = [
    `TASK: draft a ${kind === 'pack' ? 'flow enrollment pack' : 'single next-step message'} for the contact below.`,
    `CONTACT: ${JSON.stringify({ name: contact.name, title: contact.title, persona: contact.persona, step: contact.step, hook: contact.hook || null, status: contact.status, nextAction: contact.nextAction })}`,
    ...(dueStep
      ? [`DUE TODAY (Groove flow step): ${dueStep.slice(0, 200)} — draft the message for THIS step. If the step is an email step ("Send email"/"Send email template"), channel MUST be "email" and the draft is a brand-NEW standalone email advancing a NEW facet of the thread — never a reply, never a repeat of a prior proof point. NEVER assume a step is the flow's last email: "closing the loop"/permission-to-close framing is allowed ONLY when the step name itself marks it ("break up", "final", "close") — a day number, even a high one, is not that signal; mid-flow emails keep the full-value shape and FOMO CTA per anatomy.md. If it is a LinkedIn step ("Linkedin Activity", "InMail"), channel MUST be "linkedin" — a quick relevant touch per anatomy.md, not a value pitch. If it is a VM step ("VM"/"voicemail" in the name), channel MUST be "call" and the body MUST be a full spoken voicemail script per anatomy.md's "Voicemail scripts" section — signal open, real-stakes urgency line, one value line, email/callback CTA — never bullet talking points. Any other call step ("Cold Call") is a live-dial step: talking points + the no-answer voicemail fallback per anatomy.md.`]
      : []),
    ...(batchContext
      ? [`ALREADY DRAFTED for colleagues at this account today — assume they forward and compare emails:\n${batchContext.slice(0, 4000)}\nHard requirement: do NOT reuse any of these subjects, opening lines, or hook framings. Take a genuinely different angle for THIS person: a different proof point, a different facet (head-to-head result vs category absence vs review-equity vs news/hiring), or the next-best grounded play — and tie it to THIS person's role. Near-identical emails across colleagues read as blast automation and burn the whole account.`]
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
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
      output_config: { effort },
      system: [
        { type: 'text', text: SYSTEM },
        // Plays + stats change rarely — cache across drafts for any contact.
        { type: 'text', text: `PLAYS + STATS LIBRARY:\n\n${plays}`, cache_control: { type: 'ephemeral' } },
        ...(dossier
          ? [{ type: 'text', text: `Account research dossier (JSON):\n${dossier}`, cache_control: { type: 'ephemeral' } }]
          : []),
        { type: 'text', text: `Today's date: ${new Date().toISOString().slice(0, 10)}` },
      ],
      messages: [{ role: 'user', content: userPayload }],
    })

    stream.on('text', (delta) => send({ type: 'delta', text: delta }))

    const msg = await stream.finalMessage()
    if (msg.stop_reason === 'refusal') {
      send({ type: 'error', error: 'Claude declined to draft this request.' })
    } else {
      const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
      const draft = parseJson(text)
      send({
        type: 'done',
        contactId,
        kind,
        draft,
        ...(draft ? {} : { raw: text }),
        usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
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
