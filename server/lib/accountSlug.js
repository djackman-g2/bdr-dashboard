// One place that turns a Groove/tracker account NAME into a research-index
// slug. Both readers of an account's research share it — draft.js (dossier),
// storyline.js (storyline card + draft grounding) and draft-due-csv.js
// (tracker account creation) — for the same reason storyline.js already owns
// storyline resolution: if the card shows research for an account, the draft
// for that account must have loaded the same bytes.
//
// Why this exists (2026-09-08). The fallback used to be a raw
// `a.name.toLowerCase() === accountName.toLowerCase()` match. Groove's account
// names are typed by humans and drift from Salesforce's, so:
//   Groove "Kibo"           vs index "Kibo Software"   → miss
//   Groove "Configit Quote" vs index "Configit"        → miss
// Both accounts have a full dossier AND a hand-authored storyline on disk, and
// both drafted with neither — silently, because a missing dossier is a
// supported state (the prompt just says "unresearched account"). There is no
// error to notice; the drafts simply come out generic.
//
// Deliberately NOT fuzzy. A substring match would bind Groove's "Magic" to the
// index's "Magic Software" — plausibly two different companies (magic.dev vs
// magicsoftware.com), and drafting Magic Software's research at Magic's people
// is worse than drafting nothing. So: normalised exact match, then an explicit
// hand-curated alias map, then give up and report it.
import fs from 'node:fs/promises'
import path from 'node:path'
import { paths } from './config.js'

const ALIAS_FILE = path.join(paths.dataDir, 'account-aliases.json')

// Case, punctuation and spacing only. "Kibo Software" and "kibo-software"
// normalise together; "Kibo" and "Kibo Software" deliberately do not.
export const normalizeAccountName = (name) =>
  (name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

let cache = null

async function loadTables() {
  if (cache) return cache
  const byName = new Map()
  try {
    const index = JSON.parse(await fs.readFile(path.join(paths.dataDir, 'index.json'), 'utf8'))
    for (const a of index.accounts ?? []) {
      if (a.name && a.slug) byName.set(normalizeAccountName(a.name), a.slug)
    }
  } catch {
    /* no research index yet — aliases can still resolve */
  }
  // { "<groove account name>": "<research-index slug>" } — hand-curated only.
  let aliases = {}
  try {
    aliases = JSON.parse(await fs.readFile(ALIAS_FILE, 'utf8'))
  } catch {
    /* optional file */
  }
  const byAlias = new Map()
  for (const [name, slug] of Object.entries(aliases)) {
    if (typeof slug === 'string' && slug) byAlias.set(normalizeAccountName(name), slug)
  }
  cache = { byName, byAlias }
  return cache
}

// Drop the memoised tables — for long-lived processes that outlive an edit to
// index.json or the alias file (the server holds this module for days).
export function invalidateAccountSlugCache() {
  cache = null
}

// Returns a research-index slug, or null. An explicit alias wins over the
// index: the alias file exists precisely to correct names the index gets wrong
// for this purpose.
export async function resolveIndexSlug(accountName) {
  if (!accountName) return null
  const { byName, byAlias } = await loadTables()
  const key = normalizeAccountName(accountName)
  return byAlias.get(key) ?? byName.get(key) ?? null
}
