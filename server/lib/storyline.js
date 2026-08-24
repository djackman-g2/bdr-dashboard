// Storyline files (data/accounts/<slug>.storyline.json) are the account-level
// narrative layer: one thesis (the SPINE) split into per-contact CHAPTERS, plus
// the claims ledger and verification gate. Authored by hand in desktop sessions
// — nothing here writes them. data/plays/storyline.md holds the rules that
// govern how a draft may use one.
//
// Slug resolution lives here (not in draft.js) so the account page and the
// draft engine can never disagree about which file an account has: if the card
// shows a storyline, the draft for that account loaded the same bytes.
import fs from 'node:fs/promises'
import path from 'node:path'
import { paths } from './config.js'
import { readStore } from './trackerStore.js'

async function readStorylineFile(slug) {
  const file = path.join(paths.accountsDir, `${slug}.storyline.json`)
  // Never read outside data/accounts — slug arrives from a URL param.
  if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
  try {
    return await fs.readFile(file, 'utf8')
  } catch {
    return null
  }
}

// Returns the raw file text, or null. Same drift tolerance as loadDossier:
// tracker account ids are supposed to be research-index slugs, but rows created
// from Groove account names drift ("cresta" vs the index's "cresta-com"), so a
// direct miss falls back to matching the account NAME in the research index.
export async function loadStoryline(slug, accountName) {
  const direct = await readStorylineFile(slug)
  if (direct || !accountName) return direct
  try {
    const index = JSON.parse(await fs.readFile(path.join(paths.dataDir, 'index.json'), 'utf8'))
    const hit = (index.accounts ?? []).find((a) => a.name?.toLowerCase() === accountName.toLowerCase())
    return hit?.slug ? await readStorylineFile(hit.slug) : null
  } catch {
    return null
  }
}

// GET /api/storyline/:accountId — read-only. accountId is either a research
// index slug (the account page passes that) or a tracker account id (whose
// name resolves the index slug). Parsed JSON, or 404 when the account has no
// storyline — which is the normal case for most accounts.
export async function handleStoryline(req, res) {
  const { accountId } = req.params
  if (typeof accountId !== 'string' || !accountId) {
    return res.status(400).json({ error: 'accountId is required' })
  }

  // The name is only needed for the drift fallback; an unreadable tracker
  // store must not stop a direct slug hit from resolving.
  let accountName = null
  try {
    const store = await readStore()
    accountName = store.accounts.find((a) => a.id === accountId)?.name ?? null
  } catch {
    /* tracker unreadable — direct read still works */
  }

  const raw = await loadStoryline(accountId, accountName)
  if (!raw) return res.status(404).json({ error: 'no storyline for this account' })
  try {
    return res.json(JSON.parse(raw))
  } catch (err) {
    // A hand-authored file with a syntax error is a real problem to surface,
    // not a missing storyline — say which file and what broke.
    return res.status(500).json({ error: `storyline file is not valid JSON: ${err.message}` })
  }
}
