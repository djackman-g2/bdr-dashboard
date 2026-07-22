// Phase 6 — chat panel backend. Answers questions grounded on one account's
// research JSON via the Anthropic API directly (no MCPs, no tools — the
// pipeline is the only layer that researches; chat only reads what's on disk).
// The API key lives in the macOS Keychain, never in a file:
//   security add-generic-password -a "$USER" -s bdr-dashboard-anthropic -w
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { config, paths } from './config.js'

const chatConfig = config.chat ?? {}
const MODEL = chatConfig.model ?? 'claude-opus-4-8'
const MAX_TOKENS = chatConfig.max_tokens ?? 16000
const KEYCHAIN_SERVICE = chatConfig.keychain_service ?? 'bdr-dashboard-anthropic'
const MAX_HISTORY = chatConfig.max_history_messages ?? 40
const MAX_MESSAGE_CHARS = 20_000

let client = null

function readKeychainKey() {
  return new Promise((resolve, reject) => {
    execFile('security', ['find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], (err, stdout) => {
      if (err) reject(new Error('no-key'))
      else resolve(stdout.trim())
    })
  })
}

// Shared by the chat panel and the ai_visibility runner (7G-1) — one cached
// client, one Keychain read. Throws 'no-key' when the Keychain entry is absent.
export async function getClient() {
  if (!client) {
    client = new Anthropic({
      apiKey: await readKeychainKey(),
      // Optional LiteLLM/proxy gateway (config.chat.base_url) — must expose the
      // Anthropic /v1/messages surface. null/absent = api.anthropic.com.
      ...(chatConfig.base_url ? { baseURL: chatConfig.base_url } : {}),
    })
  }
  return client
}

// Drop the cached client so a rotated Keychain key is re-read next request.
export function invalidateClient() {
  client = null
}

export { MODEL as CHAT_MODEL, KEYCHAIN_SERVICE }

const SYSTEM_INSTRUCTIONS = `You are the research copilot inside a private account-research dashboard used by Declan Jackman, a BDR on G2's Mid-Market sales team, for prospecting, outbounding, and pre-call prep. Each conversation is about exactly one target account; that account's full research dossier (JSON, assembled by an automated pipeline from Salesforce, ZoomInfo, G2, Gong, news, and LinkedIn verification) is provided below.

Ground rules:
- Ground every claim about the account in the dossier. If the dossier doesn't cover something, say so plainly — never invent facts, contacts, numbers, or news about the account. General sales craft (how to phrase an opener, how to run discovery) doesn't need grounding.
- Respect the dossier's own caveats: values flagged unverified_estimate are estimates; contacts not marked verified are "unconfirmed — verify before outreach"; news without date_confirmed_on_page has an unconfirmed date. Carry these caveats into your answers.
- Treat G2 buyer-intent with caution: raw intent pulls in this org have proven unreliable (tenant-scoped, not product-scoped). Follow the dossier's lead — intent that the pipeline promoted into the messaging or intent sections has been vetted and is fair game; never introduce intent companies from anywhere else, and if intent appears only under discrepancies, don't cite it.
- Research is not qualification: signals are things to probe on a call, not verdicts.
- Declan sells G2's seller solutions (marketing/intent products for software vendors). Useful angles usually connect the account's situation (funding, hiring, competition, reviews, leadership changes) to why buyer visibility on G2 would matter to them now.
- Write in plain text only — no markdown syntax, no headers, no asterisks. Short paragraphs and simple dashes for lists are fine.
- Be concise and direct; lead with the answer. When drafting outreach, sound like a sharp human BDR, not a template.`

async function loadAccount(slug) {
  const file = path.join(paths.accountsDir, `${slug}.json`)
  // Slug comes from the URL bar — resolve and confine to the accounts dir.
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

function validMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return false
  return messages.every(
    (m) =>
      m &&
      (m.role === 'user' || m.role === 'assistant') &&
      typeof m.content === 'string' &&
      m.content.length > 0 &&
      m.content.length <= MAX_MESSAGE_CHARS
  )
}

export async function handleChat(req, res) {
  const { slug, messages } = req.body ?? {}
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    return res.status(400).json({ error: 'slug must be an account slug' })
  }
  if (!validMessages(messages)) {
    return res.status(400).json({ error: 'messages must be a non-empty [{role: "user"|"assistant", content: string}] array' })
  }
  if (messages[messages.length - 1].role !== 'user') {
    return res.status(400).json({ error: 'last message must be from the user' })
  }

  const accountJson = await loadAccount(slug)
  if (accountJson == null) return res.status(404).json({ error: `no account file for "${slug}"` })

  let anthropic
  try {
    anthropic = await getClient()
  } catch {
    return res.status(503).json({
      error:
        'Anthropic API key not set. Add it to the macOS Keychain (it is never stored in a file): ' +
        `security add-generic-password -a "$USER" -s ${KEYCHAIN_SERVICE} -w`,
    })
  }

  // NDJSON stream: {type:"delta",text} | {type:"done",usage,stop_reason} | {type:"error",error}
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
      system: [
        { type: 'text', text: SYSTEM_INSTRUCTIONS },
        {
          type: 'text',
          text: `Account research dossier (JSON):\n${accountJson}`,
          // Stable between pipeline refreshes — cache it so follow-up turns
          // only pay for the conversation, not the dossier.
          cache_control: { type: 'ephemeral' },
        },
        { type: 'text', text: `Today's date: ${new Date().toISOString().slice(0, 10)}` },
      ],
      messages: messages.slice(-MAX_HISTORY),
    })

    stream.on('text', (delta) => send({ type: 'delta', text: delta }))

    const final = await stream.finalMessage()
    if (final.stop_reason === 'refusal') {
      send({ type: 'error', error: 'Claude declined to answer this request.' })
    }
    send({
      type: 'done',
      stop_reason: final.stop_reason,
      usage: {
        input_tokens: final.usage.input_tokens,
        output_tokens: final.usage.output_tokens,
        cache_read_input_tokens: final.usage.cache_read_input_tokens,
        cache_creation_input_tokens: final.usage.cache_creation_input_tokens,
      },
    })
  } catch (err) {
    // Headers already sent — report over the stream. Distinguish the cases a
    // user can act on; keychain key stays cached unless auth actually failed.
    if (err instanceof Anthropic.AuthenticationError) {
      invalidateClient()
      send({ type: 'error', error: 'Anthropic API key was rejected — update the Keychain entry and retry.' })
    } else if (err instanceof Anthropic.RateLimitError) {
      send({ type: 'error', error: 'Anthropic rate limit hit — wait a moment and retry.' })
    } else if (err instanceof Anthropic.APIConnectionError) {
      send({ type: 'error', error: 'Could not reach the Anthropic API — check your connection.' })
    } else {
      console.error('[chat] error:', err)
      send({ type: 'error', error: err.message ?? 'chat failed' })
    }
  } finally {
    res.end()
  }
}
