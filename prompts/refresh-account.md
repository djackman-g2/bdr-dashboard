# Refresh one account (deep pipeline)

You are the research engine for the BDR Account Research Dashboard. Input: an account identifier (domain, company name, or Salesforce Account Id) passed alongside this prompt. Read `CLAUDE.md` and `config/config.json` first; the data-integrity rules there are non-negotiable. Output: one JSON file conforming to `schema/account.schema.json`, plus updates to `data/index.json` and `data/meta.json`.

Run mode: `deep` unless told otherwise. Never run Playwright/LinkedIn steps in a scheduled/light run.

## Step 0 — Run log open

Append a run entry to `data/meta.json` (`runs[]`) with EXACTLY this shape — field names and types matter, downstream credit auditing reads them:

```json
{"id": "<job id passed to you>", "started": "<ISO>", "finished": null, "mode": "deep", "trigger": "<api|cron|interactive>",
 "accounts_touched": [], "credits_consuming_calls": [], "errors": [], "notes": []}
```

- `credits_consuming_calls`: one object **per paid call, appended when the call is made** — `{"tool": "zoominfo.account_research", "target": "<domain / zi id / batch>", "at": "<ISO>", "note": "<why>"}`. A run whose notes mention paid calls but whose `credits_consuming_calls` is empty is a data-integrity violation.
- `notes`: an ARRAY of strings (never one concatenated string). Same for `errors`.

Update the entry as you go; finalize at the end. If any connected MCP fails to authenticate (common headless), record it loudly in `errors[]` AND in the account's `sources_missing` — never produce silently thin JSON.

## Step 1 — Salesforce (source of truth for CRM)

`soqlQuery` the Account by the given identifier within the universe `WHERE BDR__c = '<config.salesforce.bdr_user_id>'`. Pull the configured account fields, open Opportunities (`getRelatedRecords` or subquery), and recent CRM context. Remember:
- `LastActivityDate` may be FUTURE-dated in this org; discard dates > today.
- CRM activity is never proof a contact still works there.

## Step 2 — Canonical domain

Resolve the canonical domain from `Account.Website` (strip scheme/www, lowercase). If missing or a redirect/parked page, resolve via web search + fetch of the company site. Domain is the key for every enrichment call and the filename (`data/accounts/{domain-with-dashes}.json`). Check CLAUDE.md "Known account corrections" and apply any overrides (record them in `corrections_applied`).

## Step 3 — ZoomInfo (domain-first, log paid calls)

1. `search_companies` with `companyWebsite=<domain>` (free) → get `zoominfoCompanyId`.
2. `account_research` with that id (PAID — log in run entry `credits_calls`).
3. Optionally `enrich_scoops` / `search_intent` for signals (log if paid).
Never make a paid call off a name match. Store `zoominfoCompanyId` in firmographics.
Do NOT attempt `enrich_intent` (deprecated 2026-07-03, not allowlisted) or `enrich_company_signals` (credit-consuming, deliberately not allowlisted) — they will permission-deny in headless runs; do not record these as `sources_missing` or errors, they are intentionally excluded.

## Step 4 — Cross-check headcount/revenue

Never report headcount/revenue from a single enrichment source (ZoomInfo is often ~an order of magnitude stale for private companies). Cross-check at least one of: LinkedIn company page (Playwright, deep runs only), careers-page role count, recent press. Agreement → `status: verified`. No corroboration → `status: unverified_estimate`. Disagreement → trust the live source, record in `discrepancies`, never average.

## Step 5 — G2 presence + intent

- Web-first: find the vendor/products on g2.com; then `show_product`/`show_vendor` by slug for ratings/review counts. Use the **G2 MCP Server** tools (`mcp__claude_ai_G2_MCP_Server__*`) — the `G2_MCP_Dev` variants are not allowlisted and will permission-deny headless.
- Attempt seller intent tools (`browse_buyer_intent` etc.). Known issue: `list_my_products` returns empty under this login — if intent tools fail, record in `sources_missing` and move on. Write a 1-2 sentence `g2.presence_summary` (the outreach wedge).

## Step 6 — Gong

Attempt `ask_account` for call history/context. If OAuth stub only or unavailable, record in `sources_missing` (user authenticates via `/mcp` interactively).

## Step 7 — News (free path, default)

WebSearch to discover items in `config.news.lookback_days` → WebFetch the actual source page to confirm date, publisher, and claim → Playwright as renderer fallback for JS-heavy pages. Every item needs `url` + `published_at` read from the page itself (`date_confirmed_on_page: true`); an item whose date can't be confirmed on-page must not claim a date. Use Apify rag-web-browser ONLY if `config.news.use_apify` is true. Store items in `news[]` and material events (funding, leadership, layoffs, launches, M&A) in `signals[]` as timestamped events with a `probe` question.

## Step 8 — Hiring

Careers page (WebFetch/Playwright): total open roles, role mix by function, growth direction. Hiring velocity beats headcount as a buying signal. Store as of a timestamp.

## Step 9 — ICP contacts

Candidates from ZoomInfo (`search_contacts` free → `enrich_contacts` paid, log it) and Salesforce Contacts. Sanity-check `get_recommended_contacts` persona fit; discard mismatches. Every contact enters `icp_contacts` as `verification.status: "unconfirmed"` UNLESS independently verified (LinkedIn via Playwright — deep runs only, low volume, human pacing — or ZoomInfo enrich with recent as-of). A failed LinkedIn lookup marks the contact `unconfirmed`; it never blocks the pipeline.

## Step 10 — Messaging

From verified facts only: 2-4 angles (each with `grounded_in` pointing at a specific signal/news/fact in this record), 2-3 openers, and `things_to_probe` (research is not qualification — store questions, not verdicts).

## Step 11 — Write + validate

1. Build the account JSON. Set `confidence` honestly (missing sources or unverified key facts → medium/low).
2. Validate against `schema/account.schema.json`: `npx --yes -p ajv-cli@5 -p ajv-formats ajv validate -c ajv-formats --spec=draft7 -s schema/account.schema.json -d data/accounts/{slug}.json`. Fix violations before writing.
3. Write `data/accounts/{slug}.json` (atomic: write temp file, then rename).
4. Update `data/index.json`: upsert `{slug, domain, name, industry, employees_display, confidence, refreshed_at, top_signal, status: "active"}` — always set `status` (a completed deep refresh moves the account out of `pending_research`; omitting the field breaks dashboard status filters).
5. Finalize the run entry in `data/meta.json`: `finished`, accounts touched, credit-consuming calls made, errors.

## Source discipline (applies to every step)

Attempt EVERY connected MCP before any web-only fallback; genuinely unavailable after attempt → `sources_missing` + lower confidence. Never silently skip. Time-boundable metrics are stored as timestamped events, never aggregates.

Every `sources_missing` entry sets `kind`:
- `"deferred_by_design"` — intentionally skipped per standing policy (LinkedIn contact verification pre-Phase 5, ZoomInfo intent/signals by cost policy, Apify off). Not a failure; does not lower confidence by itself.
- `"attempted_failed"` — genuinely attempted and unavailable (outage, 404, empty result, auth failure). Lowers confidence.
