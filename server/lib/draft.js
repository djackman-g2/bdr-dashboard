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

Choose the best play from the library using its trigger table (winback beats generic if CRM history shows churn; aeo-screenshot needs an ai_visibility result; etc.). Personalize from dossier facts: top_signal, ai_visibility results, news, hiring, G2 review counts, CRM history.

Output STRICT JSON only — no markdown fences, no commentary outside the JSON.`

const PACK_CONTRACT = `Return JSON:
{
  "play": "<play name>",
  "rationale": "<2-3 sentences: why this play, which account facts you used>",
  "flag_warnings": ["<any account flags, verbatim>"],
  "emails": [
    {"slot": "email1", "subject": "...", "body": "..."},
    {"slot": "email2", "subject": "...", "body": "..."},
    {"slot": "email3", "subject": "...", "body": "..."}
  ],
  "linkedin_inmail": "<InMail body, <=100 words>",
  "call_points": ["<3-5 bullet talking points for the flow's call steps>"]
}
The three emails are Days 1/7/14 of the flow: they must escalate as a coherent thread (email2 references "my last note", email3 is the sharpest/shortest), never repeat the same proof point twice. Bodies are plain text, line breaks as \\n, 60-120 words each, no HTML.`

const NEXT_CONTRACT = `Return JSON:
{
  "play": "<play name>",
  "rationale": "<2-3 sentences: why this message now, what the thread history shows>",
  "flag_warnings": ["<any account flags, verbatim>"],
  "channel": "email" | "linkedin" | "call",
  "subject": "<subject, or null for linkedin/call>",
  "body": "<the message (or call talking points if channel=call), plain text>"
}
Continue the thread: reference what was already sent (from the touch history) without repeating its proof point. If the contact replied, this is a reply-handling message, not a cold touch.`

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
  const { contactId, kind } = req.body ?? {}
  if (typeof contactId !== 'string' || !contactId) {
    return res.status(400).json({ error: 'contactId is required' })
  }
  if (kind !== 'pack' && kind !== 'next') {
    return res.status(400).json({ error: 'kind must be "pack" or "next"' })
  }

  const store = await readStore()
  const contact = store.contacts.find((c) => c.id === contactId)
  if (!contact) return res.status(404).json({ error: 'no such contact' })
  const account = store.accounts.find((a) => a.id === contact.accountId) ?? null

  const [plays, dossier, mirror] = await Promise.all([
    loadPlaysLibrary(),
    loadDossier(contact.accountId),
    loadMirrorEntry(contact),
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

  const personaEntry = contact.persona ? personas[contact.persona] : null
  const userPayload = [
    `TASK: draft a ${kind === 'pack' ? 'flow enrollment pack' : 'single next-step message'} for the contact below.`,
    `CONTACT: ${JSON.stringify({ name: contact.name, title: contact.title, persona: contact.persona, step: contact.step, hook: contact.hook || null, status: contact.status, nextAction: contact.nextAction })}`,
    personaEntry ? `PERSONA PROFILE (${contact.persona}): ${JSON.stringify(personaEntry)}` : 'PERSONA PROFILE: none assigned — infer carefully from the title, note it in the rationale.',
    `TRACKER ACCOUNT: ${JSON.stringify(account ?? { id: contact.accountId })}  (flags are coordination warnings — surface them)`,
    mirror
      ? `GROOVE TOUCH HISTORY (from Salesforce, newest first): ${JSON.stringify({ flow: mirror.flow, flow_day: mirror.flow_day, replied: mirror.replied, last_inbound: mirror.last_inbound, touches: mirror.touches.slice(0, 12) })}`
      : 'GROOVE TOUCH HISTORY: none on record — treat as a cold first touch.',
    dossier ? 'The account research dossier is provided in the system context.' : 'NO DOSSIER: this account is unresearched — play + persona + canonical stats only; no invented company facts.',
    kind === 'pack' ? PACK_CONTRACT : NEXT_CONTRACT,
  ].join('\n\n')

  try {
    const msg = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      thinking: { type: 'adaptive' },
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
    const text = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('')
    const draft = parseJson(text)
    res.json({
      contactId,
      kind,
      draft,
      ...(draft ? {} : { raw: text }),
      usage: { input_tokens: msg.usage.input_tokens, output_tokens: msg.usage.output_tokens },
    })
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      invalidateClient()
      return res.status(503).json({ error: 'Anthropic API key was rejected — update the Keychain entry and retry.' })
    }
    console.error('[draft] error:', err)
    res.status(502).json({ error: err.message ?? 'draft failed' })
  }
}
