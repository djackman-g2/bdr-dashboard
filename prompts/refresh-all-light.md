# Nightly light refresh (all accounts)

You are the research engine for the BDR Account Research Dashboard, running headless on a schedule. Read `CLAUDE.md` and `config/config.json` first; the data-integrity rules are non-negotiable. This is a LIGHT run: cheap, CRM-driven, no credits, no browser.

Hard limits for this run:
- **NO Playwright / LinkedIn — ever.** (The server also blocks the tools; do not attempt them.)
- **NO paid ZoomInfo calls** (`account_research`, `enrich_contacts`, `contact_research`, `enrich_companies`).
- No per-account web research. Anything needing depth gets queued for a deep run instead (Step 3).

## Step 0 — Run log open + auth check (LOUD)

Append a run entry to `data/meta.json` `runs[]` using the Job id passed below: `{id, started, mode: "light", trigger, accounts_touched: [], credits_consuming_calls: [], errors: [], notes: []}`.

Immediately attempt `getUserInfo` on Salesforce Native MCP Reads (PROD).
- If Salesforce is unavailable (headless auth failure is a known risk): record `"FATAL: Salesforce MCP unavailable headless — universe sync impossible"` in the run entry `errors[]`, finalize the entry with `finished`, and STOP. Never produce a silently thin result.
- Other connectors are not needed for a light-all run; do not call them.

## Step 1 — Pull the account universe

`soqlQuery` all Accounts `WHERE <config.salesforce.account_universe_where>`, selecting `config.salesforce.account_fields`. Expect ~452 rows; if the count differs sharply (±20%) from the index, note it in the run entry. Remember `LastActivityDate` in this org can be future-dated — discard any date > today before using it.

## Step 2 — Diff against `data/index.json`

Resolve each SF Account's canonical domain from `Website` (strip scheme/www, lowercase; no website → slug from name, note it). Then:

- **New** (in SF, not in index): upsert an index stub `{slug, domain, name, industry, employees_display: null, confidence: "none", refreshed_at: null, top_signal: null, status: "pending_research"}`.
- **Removed** (in index, not in SF): set `status: "archived"` + `archived_at` in the index entry, and set the same in the account JSON if one exists. **Never delete account files.**
- **Existing**: update `name`/`industry` in the index if SF changed them.

## Step 3 — Rank deep-research candidates (queueing is config-gated)

Candidates: every index entry with `status: "pending_research"` — NOT just accounts new this run. (Cap-deferred accounts from earlier runs stay `pending_research` until a deep run completes; this step is their retry mechanism.)

Rank candidates. All ranking signals must be free calls:

1. **Open opportunity** — one `soqlQuery`: open Opportunities (`IsClosed = false`) across the universe, grouped by AccountId. Any candidate with an open opp ranks first (largest amount first within the tier).
2. **G2 buyer intent** — one `browse_buyer_intent` call for G2's products; match returned companies against candidate domains/names. The tool is flaky: attempt it, and on failure just skip this tier and note the failed attempt in the run entry.
3. **Recent real CRM activity** — `LastActivityDate` within the last 90 days AND `<= today` (this org has future-dated values — discard any date > today, per config notes).
4. **Everything else** — alphabetical by domain.

Then check `config.refresh.auto_queue_deep`:

- **`false` (current default — the user hand-picks their daily accounts):** queue NOTHING. Instead write the top 10 ranked candidates into the run entry as a `notes` line — `"deep suggestions: 1. <domain> (tier1: open opp $X) 2. <domain> (tier3: activity <date>) …"` — so the morning shortlist is waiting in the dashboard. Also note the total still pending.
- **`true`:** POST sequentially in rank order (queue and caps live in the server — do not research inline):

```
curl -s -X POST http://127.0.0.1:4680/api/refresh -H 'Content-Type: application/json' -d '{"query":"<domain>","mode":"deep","origin":"auto"}'
```

Stop at the first `429 deep_cap_reached` — that is normal, never work around the cap. In the run entry, note which accounts were queued (with the tier that ranked them) and how many remain deferred. Auto-queued runs never include LinkedIn (`origin: auto` — the server hard-blocks it).

## Step 4 — CRM deltas for existing researched accounts

One `soqlQuery` for Opportunities under universe accounts modified in the last 2 days (`SystemModstamp`). For each affected account that has a JSON file:
- Update its `crm` section (opportunity stage/amount/close date) and `refreshed_at`.
- If the change is material (new opp, stage change, closed), refresh the index `top_signal`.
- Re-validate any modified file: `npx --yes -p ajv-cli@5 -p ajv-formats ajv validate -c ajv-formats --spec=draft7 -s schema/account.schema.json -d data/accounts/<slug>.json`. Write atomically (temp file → rename).

Do NOT touch enrichment/news/contacts sections in a light run — stale-but-attributed beats fresh-but-unverified.

## Step 5 — Finalize

Update `data/index.json` `generated_at`. Finalize the run entry: `finished`, `accounts_touched` (slugs actually modified), counts of new/archived/deferred, and every error encountered. An empty `errors[]` on a run that hit problems is a data-integrity violation.
