# PLAN: storyline layer wiring

Written 2026-08-23 from the Claude desktop storyline session. Two files already
exist and need no code: `data/plays/storyline.md` (rules — the draft engine
reads the whole plays dir) and `data/accounts/cresta.storyline.json` (first
storyline + corrected-voice exemplars).

## The one code change (server/lib/draft.js)

Goal: when `data/accounts/<slug>.storyline.json` exists for the contact's
account, include it in the drafting context the same way the dossier is
included.

1. Add a loader next to `readDossierFile` / `loadDossier`:

```js
async function loadStoryline(slug, accountName) {
  const read = async (s) => {
    const file = path.join(paths.accountsDir, `${s}.storyline.json`)
    if (path.dirname(path.resolve(file)) !== path.resolve(paths.accountsDir)) return null
    try { return await fs.readFile(file, 'utf8') } catch { return null }
  }
  const direct = await read(slug)
  if (direct || !accountName) return direct
  try {
    const index = JSON.parse(await fs.readFile(path.join(paths.dataDir, 'index.json'), 'utf8'))
    const hit = (index.accounts ?? []).find((a) => a.name?.toLowerCase() === accountName.toLowerCase())
    return hit?.slug ? await read(hit.slug) : null
  } catch { return null }
}
```

2. In `handleDraft`, extend the parallel load:

```js
const [plays, dossier, storyline, mirror, sentDrafts] = await Promise.all([
  loadPlaysLibrary(),
  loadDossier(contact.accountId, account?.name),
  loadStoryline(contact.accountId, account?.name),
  loadMirrorEntry(contact),
  loadDashboardSent(contactId),
])
```

3. In the `system` array, after the dossier block:

```js
...(storyline
  ? [{ type: 'text', text: `Account STORYLINE (data/plays/storyline.md governs how to use this):\n${storyline}`, cache_control: { type: 'ephemeral' } }]
  : []),
```

4. In `userPayload`, one line so the model knows which regime applies:

```js
storyline ? 'A STORYLINE exists for this account — chapter discipline, claim gates, and pairings in storyline.md are binding for this draft.' : null,
```
(filter nulls, or mirror the dossier's present/absent phrasing.)

5. Optional, later: surface `verification[].status === "pending"` items into
   `flag_warnings` in code rather than trusting the model to copy them.

## Claude Code prompt (paste into Claude Code at the repo root)

"Read PLAN-STORYLINE.md and data/plays/storyline.md, then make the draft.js
change exactly as specified: add loadStoryline, load it in parallel in
handleDraft, inject it as a cached system block after the dossier, and add the
one-line userPayload notice. Don't change SYSTEM, the contracts, or any other
behavior. After the edit, run the server and hit POST /api/draft for a tracker
contact on the Cresta account (kind 'next', any dueStep) and confirm the NDJSON
'done' payload's rationale mentions the storyline. Keep the diff minimal."

## Later phases (no action now)

- Notion team layer: created from the desktop app via the Notion connector
  (three databases: Storylines, Cast, Claims) + a small nightly push script in
  server/scripts. Only needed when teammates start using the system.
- /storyline-mesh skill for teammates: authored in the desktop app with
  skill-creator, bundling gates.md + anatomy.md + storyline.md so the rules
  travel without this repo.

## Storyline card on the account page (added 2026-08-24)

Goal: make storyline files visible in the dashboard UI. Currently only the
draft engine reads them; the account page shows nothing.

Spec:
- On the account detail view (#/accounts/:id), if
  `data/accounts/<slug>.storyline.json` exists for the account, render a
  "Storyline" card between the dossier/research section and the contacts
  table. Resolve the slug the same way draft.js's loadStoryline does (direct
  id, then index-name fallback) — factor that resolution into a shared helper
  rather than duplicating it.
- Card contents, top to bottom:
  1. `mode` badge (full_custom / template_flow) + `created` date.
  2. `spine` as a short paragraph.
  3. Cast table: contact, chapter, one-line angle, status chip. Status logic:
     BLOCKED (status field contains "BLOCKED") = red chip; MID-FLOW = amber;
     otherwise green "ready".
  4. Claims ledger: one row per entry — colleague, state, allowed phrasing.
  5. Verification gate: pending items in red, cleared in green, failed in red
     bold. Any pending item also renders as a banner at the top of the card:
     "N verification items pending — check before sending".
- Server side: add GET /api/storyline/:accountId returning the parsed JSON or
  404 (reuse the loader; never read arbitrary paths). Dashboard fetches it
  lazily when the account view mounts.
- Read-only for now — no editing UI. Edits happen in the desktop app sessions.
- Do not touch the drafting code paths.

Also in the same pass (small): in draft.js, when parseJson returns null,
retry the model call ONCE before falling back to raw text. Log the retry.
This guards the occasional non-JSON emission (JS expression inside a string)
seen on 2026-08-24.
