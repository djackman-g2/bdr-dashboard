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

`soqlQuery` all Accounts `WHERE <config.salesforce.account_universe_where>`, selecting `config.salesforce.account_fields`. Expect ~289 rows (FY27 universe, corrected 2026-07-21 — the first run after the correction will see ~163 legacy accounts archive; that one-time wave is expected, note it and move on); if the count differs sharply (±20%) from the index, note it in the run entry. Remember `LastActivityDate` in this org can be future-dated — discard any date > today before using it.

The pull now includes 6sense + hierarchy fields (`X6sense_*`, `*_SOM__c`, etc.). Copy them into each account JSON's `salesforce` section (snake_case names per the schema: `buying_stage_6sense`, `intent_score_6sense`, `is_6qa`, `total_hierarchy_acv`, `total_hierarchy_som`, `available_som`, `active_products_in_hierarchy`, `claimed_profiles`, `profile_completeness_pct`, `reviews_last_60_days`) when updating existing files. **6sense stage/score is a PRIORITIZATION signal only — it must never be referenced or implied in outreach copy or messaging generation.**

## Step 2 — Diff against `data/index.json`

Resolve each SF Account's canonical domain from `Website` (strip scheme/www, lowercase; no website → slug from name, note it). Then:

- **New** (in SF, not in index): upsert an index stub `{slug, domain, name, industry, employees_display: null, confidence: "none", refreshed_at: null, top_signal: null, status: "pending_research", open_opps: []}` (Step 2b fills `open_opps` immediately after).
- **Removed** (in index, not in SF): set `status: "archived"` + `archived_at` in the index entry, and set the same in the account JSON if one exists. **Never delete account files.**
- **Existing**: update `name`/`industry` in the index if SF changed them.

## Step 2b — Stamp open opportunities onto the index (2026-08-18)

One `soqlQuery`: select `config.salesforce.open_opportunity_fields` `FROM Opportunity WHERE <config.salesforce.open_opportunity_where> AND AccountId IN (<universe ids>)`. Do not hardcode the clause here — it lives in config so the rule is editable in one place (`open_opportunity_notes` explains why `IsClosed = false` is load-bearing).

Set `open_opps` on **every** index entry — `[{name, stage, amount, close_date, owner}]`, or `[]` for accounts with none. Always write the field even when empty: an absent `open_opps` is indistinguishable from "never checked", and the dashboard treats absent as unknown rather than clear. Also mirror the same list into `salesforce.open_opportunities` on any account JSON that exists (that field already uses this shape).

`IsClosed = false` is the whole test. **Closed-Lost accounts deliberately stay in the working list** — winback is an active `playType`, so a lost deal is a reason to reach out, not a reason to hide.

Why this exists: an open opportunity means the account has an AE's live deal in it. Declan must not prospect into those — it steps on Sean or Nick. This field is what lets the workbench, the picks panel, and the ranking below all honor that from one source.

## Step 3 — Rank deep-research candidates (queueing is config-gated)

Candidates: every index entry with `status: "pending_research"` **and an empty `open_opps`** — NOT just accounts new this run. (Cap-deferred accounts from earlier runs stay `pending_research` until a deep run completes; this step is their retry mechanism.)

Accounts with an open opp are **excluded from candidacy entirely** (changed 2026-08-18 — see Step 2b). They are not ranked, not suggested, and never deep-researched: he cannot contact them, so spending a ZoomInfo deep slot on one is pure credit burn. Note the count of accounts skipped this way in the run entry `notes`.

Rank candidates. All ranking signals must be free — tiers 2–4 use the 6sense fields already in the Step 1 universe pull (zero extra calls); tier 1 is one extra SOQL. Do NOT use G2 `browse_buyer_intent` for ranking (removed 2026-07-21: confirmed tenant-scoped, returns the same companies for every product — see the CLAUDE.md connector table):

1. **6sense Buying Stage Purchase, then Decision** (`stage_purchase` / `stage_decision`) — `X6sense_Account_Buying_Stage__c = 'Purchase'` first, then `'Decision'`; within each stage, intent score descending.
2. **6sense intent score** (`intent_6sense`) — remaining candidates with a nonzero `X6sense_Account_Intent_Score__c`, descending; 6QA-flagged accounts (`X6sense_6QA__c = true`) first within equal scores.
3. **Consideration stage** (`consideration_som`) — `Buying Stage = 'Consideration'`, ordered by `Available_SOM__c` descending.
4. **Recent real CRM activity** (`recent_activity`) — `LastActivityDate` within the last 90 days AND `<= today` (this org has future-dated values — discard any date > today, per config notes).
5. **Everything else** (`alphabetical`) — alphabetical by domain.

(There is no longer an `open_opp` tier. It was demoted to last on 2026-08-13, then removed outright on 2026-08-18 — demotion still let open-opp accounts fill leftover top-10 slots, which put untouchable accounts in front of him. They are now filtered out before ranking begins, in Step 3's candidate definition.)

Reasons must carry the number that ranked the account, e.g. `"6sense intent 78, stage Decision"`, `"Consideration, available SOM $250k"`. 6sense values rank who to work — they NEVER appear in outreach copy (data-integrity rule).

Then check `config.refresh.auto_queue_deep`:

- **`false` (current default — the user hand-picks their daily accounts):** queue NOTHING. Instead:
  1. Write `data/suggestions.json` (the dashboard renders it as the "Today's picks" panel):
     `{"generated_at": "<ISO>", "pending_total": <n>, "open_opp_skipped": <n>, "suggestions": [{"slug": "...", "domain": "...", "name": "...", "tier": "stage_purchase"|"stage_decision"|"intent_6sense"|"consideration_som"|"recent_activity"|"alphabetical", "reason": "<one line carrying the ranking number, e.g. '6sense intent 78, stage Decision' or 'Consideration, available SOM $250k'>"}]}` — top 10, rank order.
  2. Also add a short `notes` line to the run entry: `"deep suggestions written to data/suggestions.json (top: <first 3 domains>); <n> still pending"`.
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
