# BDR Account Research Dashboard

Local, auto-updating account research dashboard for Declan Jackman (djackman@g2.com), BDR on G2's Mid-Market team. Used for prospecting, outbounding, and pre-call prep.

## Architecture (4 layers)

1. **Research engine** — Claude Code (interactive in VS Code + headless `claude -p "$(cat prompts/...)"` spawned by the server). The ONLY layer that calls MCP tools. Writes structured JSON to disk.
2. **Data layer** — `data/accounts/{domain-slug}.json` (one per account, validated against `schema/account.schema.json`), `data/index.json` (search index), `data/meta.json` (refresh timestamps, run log, job queue state).
3. **Local server** — Express on 127.0.0.1: serves dashboard, `POST /api/refresh` ({query, mode: "light"|"deep", origin?: "user"|"auto"}) spawns headless Claude, job queue (max 1 concurrent), chokidar → SSE push, node-cron nightly light refresh. No system crontab. `origin` defaults to `auto`; only `origin: "user"` deep runs (dashboard button) are spawned with Playwright available — everything else gets `--disallowedTools 'mcp__playwright__*'`.
4. **Dashboard** — Vite + React + Tailwind SPA. Reads JSON + SSE. Never calls MCPs. Dark mode default, `/` focuses search. Styled with G2 "Elevate" design tokens (extracted from g2.com production CSS 2026-07-15) — see `@theme` in `dashboard/src/index.css`: brand red `#ff492c`, primary purple `#5746b2`, indigo-black dark surfaces, Figtree font. Rebuild (`npm run build` in `dashboard/`) after UI changes; the server serves `dist/`.

Build phases: 1) pipeline + one account end-to-end → 2) read-only dashboard → 3) server + auto-update → 4) scale to all accounts → 5) Playwright LinkedIn verification + messaging polish.

## Session facts (verified 2026-07-15)

- Salesforce user ID: `005Nw000003GH6PIAW` (Declan Jackman, role "AMER BDR")
- Account universe: `WHERE BDR__c = '005Nw000003GH6PIAW'` — **452 accounts**. NOT `OwnerId` (that returns 0; ownership sits with AEs, BDR assignment is the custom `BDR__c` lookup field). SOQL lives in config, not hardcoded.
- `Account.LastActivityDate` in this org contains FUTURE dates (2029–2036, from scheduled tasks/sequences). Unusable for sorting/recency without filtering out future dates.
- Related Account fields: `BDR__c` (lookup), `BDR_Email__c`, `BDR_First_Name__c`, `BDR_Last_Name__c`, `BDR_Notes__c`, `Parent_BDR__c`.

## Connector status (last checked 2026-07-15)

| Connector | Status | Notes |
|---|---|---|
| Salesforce Native MCP Reads (PROD) | ✅ | Source of truth for account list + CRM history. Reads only. |
| ZoomInfo | ✅ | Domain-first sequence below. Credit-consuming — log every paid call. |
| G2 MCP Server + G2 MCP Dev | ⚠️ | `list_my_products` still EMPTY. `browse_buyer_intent` works mechanically (needs the exact product slug — a wrong slug 404s and looks like a flake) BUT the returned rows are **confirmed-suspect platform/tenant-scoped, not product-scoped**: identical companies (Armis, Edwards, IonQ) across 5 different product pulls on 2026-07-15, including G2's own `g2` slug. **NEVER cite intent companies in outreach without a seller-console check.** Record pulls in `discrepancies`, keep them out of `top_signal`/messaging. Public tools (`show_product`, `show_vendor` by slug) work fine. Headless allowlist covers `G2_MCP_Server__*` only — `G2_MCP_Dev` variants permission-deny. |
| Gong MCP (PROD) | ✅ | OAuth complete, fully working (verified 2026-07-15). Org has TWO workspaces — `workspace` param is REQUIRED: use `"Initial workspace"` (other: `"Leadership"`). Accepts SF Account Id as `crmAccount`. |
| Apify (hosted MCP, project `.mcp.json`) | ⏸️ | Configured and authenticated, but OPTIONAL and OFF by default — user doesn't want per-call Apify costs. News pipeline uses the free path (below). Only use Apify when config flag `news.use_apify` is true (reserve for on-demand deep refreshes if enabled). `.mcp.json` contains the raw API key — must be gitignored. |
| Playwright MCP (local) | ✅ | LinkedIn verification only — see constraints below. Registered with `--browser chrome --user-data-dir` on the dedicated logged-in profile; session VERIFIED persisting across Playwright relaunch 2026-07-15 (`npm run linkedin:check`). Interactive sessions started before the re-registration still run the old isolated config. |
| Web search/fetch | ✅ | Breadth + recency cross-check. Never sole source for dated claims. |

**News pipeline (free path, default):** WebSearch to discover items → WebFetch the actual source page to confirm date, publisher, and claim → Playwright as renderer fallback for JS-heavy pages. Every dated item needs a source URL and a publication date read from the page itself, not from a search snippet. Apify rag-web-browser is an optional upgrade to this step, off by default (cost).

Resolved 2026-07-15: the project folder was renamed `Claude..` → `bdr-dashboard` because the trailing dots tripped Claude Code's suspicious-path check in headless runs (file tools auto-denied, forcing workarounds). If the folder is ever moved/renamed again, avoid dots in the name and re-verify a headless file write. **Also:** `claude mcp add` registrations are keyed by absolute project path in `~/.claude.json` — the rename orphaned the local Playwright MCP registration (re-added 2026-07-15 under the new path). After any future move, re-run `claude mcp list` and re-add anything missing. Post-rename headless file write verified 2026-07-15 (probe wrote to `data/`, allow rules honored).

Headless risk: **validated 2026-07-15** — a headless `claude -p` probe from the project root saw all six servers (Salesforce, ZoomInfo, G2, Gong, Playwright, Apify) and Salesforce `getUserInfo` succeeded. Caveat: claude.ai-hosted connectors are interactively authenticated, so tokens can still expire between sessions; every scheduled run re-checks auth in Step 0 and failures must surface loudly in the run log, never produce silently thin JSON. Note: `Write(path)` permission rules are ignored by Claude Code — use `Edit(path)` rules (they cover all file-editing tools).

## Data-integrity rules (non-negotiable)

1. **Domain beats name.** Resolve canonical domain first; every enrichment call keys off it.
2. **ZoomInfo sequence:** `search_companies` with `companyWebsite` (free) → `account_research` with returned `zoominfoCompanyId` (paid). Never paid calls off a name match.
3. **Never report headcount/revenue from a single enrichment source.** ZoomInfo is frequently stale ~an order of magnitude for private companies. Cross-check LinkedIn company page (Playwright) or careers-page role count. Unverifiable → flag `unverified_estimate`, UI renders warning badge.
4. **Salesforce `LastActivityDate` is NOT proof of employment** (record touches: syncs, sequences, merges — and in this org, future-dated). No CRM contact enters `icp_contacts` as a current target without independent verification (LinkedIn via Playwright, or ZoomInfo `enrich_contacts` with recent as-of). Unverified → "unconfirmed — verify before outreach" badge.
5. **Enrichment vs live source disagreement:** trust the live source, record the discrepancy in the JSON. Never average or silently pick.
6. **ZoomInfo `get_recommended_contacts`** is unreliable when its ML reference persona mismatches the target industry — sanity-check the persona reference; discard obviously wrong output.
7. **Hiring velocity beats headcount** as a buying signal — capture role mix and growth direction.
8. **Research is not qualification.** Store signals as things to probe, not verdicts.
9. Attempt EVERY connected MCP per account before any web-only fallback. Genuinely unavailable after attempt → record in `sources_missing` + lower confidence. Never silently skip.
10. Time-boundable metrics are stored as timestamped events, never aggregates, so the UI filters 7/30/90/custom client-side.
11. **Salesforce is READ-ONLY. Writing to Salesforce is 100% forbidden — no exceptions, any mode, any phase.** Only the "Salesforce Native MCP Reads (PROD)" connector may be used; every SF write connector is explicitly denied in `.claude/settings.json` and must stay denied.

## Refresh model rules

- All refreshes flow through the server → headless Claude. Queue of ONE concurrent pipeline run.
- Configurable per-day cap on deep refreshes (ZoomInfo credits + tokens).
- Scheduled nightly light refresh: re-sync account list (new → queue for full research; removed → archive, never delete), pull deltas, update timestamps. **No LinkedIn/Playwright automation in scheduled runs — ever.**
- Deep refresh (on-demand only): full pipeline incl. contact verification + fresh messaging.
- Every run appends to `data/meta.json` run log: started, finished, mode, accounts touched, credits-consuming calls made, errors.
- Prompt files `prompts/refresh-all-light.md` and `prompts/refresh-account.md` encode the full pipeline + these rules; headless must behave identically to interactive.
- Headless permissions: explicit allowlist in `.claude/settings.json` (specific MCP tools + file-write paths). No blanket permission-skipping.

## LinkedIn / Playwright constraints

Verification tool, NOT a scraper: low-volume targeted lookups (confirm one contact's title/tenure, read company headcount), deep refreshes only, human-like pacing. Automated LinkedIn access carries account-restriction risk — volume stays deliberately low. Lookup fails → mark contact `unconfirmed`, never block the pipeline.

**Phase 5 auth approach (implemented 2026-07-15): NO scripted logins, NO stored credentials.**
- Never store LinkedIn (or Sales Nav) username/password anywhere — not in the repo, not gitignored files. Scripted headless logins also trip LinkedIn's automation defenses (checkpoints/CAPTCHAs) and are a restriction signal.
- **Chrome 136+ refuses automation on the default user data dir**, so the original "ride Declan's existing profile" plan is impossible. Instead: a **dedicated persistent Chrome profile** at `~/Library/Application Support/bdr-dashboard/chrome-profile` (outside the repo; `config.linkedin.profile_dir`). Declan logs into LinkedIn + Sales Nav there once, by hand, **inside a Playwright-launched Chrome** (`cd server && npm run linkedin:login`); the Playwright MCP is registered with `--browser chrome --user-data-dir <that dir>` and inherits the session. Real Chrome never needs to be closed.
- **The profile must ONLY ever be opened through Playwright** (`npm run linkedin:login` / `linkedin:check` / the MCP). Playwright launches Chrome with `--use-mock-keychain`; a normally-launched Chrome (`open -na …`) uses the real Keychain, can't decrypt the Playwright-written cookies, and **silently destroys them** (and vice versa — verified the hard way 2026-07-15, first login was lost this way).
- Session expired (authwall in a run)? `cd server && npm run linkedin:login`, log in by hand, **Cmd+Q** the window (closing it isn't enough — the process holds the profile lock), then `npm run linkedin:check` to confirm (exit 0 = logged in).
- Runtime gating: only `origin: "user"` deep jobs get Playwright (server hard-block otherwise). Per-run budgets in `config.linkedin` (`max_contact_lookups_per_run`, `max_page_loads_per_run`, `min_seconds_between_pages`). Procedure lives in `prompts/refresh-account.md` Step 9b. Authwall/checkpoint mid-run → stop ALL LinkedIn use for that run, mark `attempted_failed`, never retry or attempt login.
- Sales Nav lookups ride the same session, same rules: targeted verification of specific contacts only, never bulk.
- If any future integration genuinely needs a stored secret → macOS Keychain, never a file.
- ZoomInfo `enrich_contacts` remains the first verification line; LinkedIn is the upgrade path for contacts ZI can't confirm.

## n8n (deferred to Phase 4/5)

User has an n8n API key. n8n is an orchestrator, not a scraper — it adds no fetching/rendering capability the free news path lacks, so do not use it for research/scraping. Do NOT put n8n in the core pipeline (queue/cap guarantees must live in one place — the server). Planned uses: morning digest webhook after nightly run, failure alerts, inbound refresh triggers. Design server webhook-out hooks in Phase 3 to make this trivial.

## Known account corrections

Facts that override enrichment data. Format: `- {domain}: {field} = {value} (source, date)`.

(none yet)
