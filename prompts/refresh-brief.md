# Brief refresh — the cheap replacement for a deep run

You are the research engine for the BDR Account Research Dashboard, running a **brief** refresh on ONE account. Read `CLAUDE.md` first — every data-integrity rule applies unchanged.

A brief run exists because deep runs cost roughly **$8-11 each** and produce a great deal the outreach drafter never reads. This mode gathers **only the dossier sections the draft engine actually cites**, using free tools, in one sequential pass. Target: **$0.30–0.60 and 5–10 minutes**.

## Cost rules — these are the whole point of this mode

1. **NO Task subagents. Run every step yourself, sequentially.** Deep's Step 2b fans out to four parallel subagents; that fan-out is most of what makes deep expensive. A brief run that spawns subagents has failed at its only job.
2. **NO paid calls, ever.** ZoomInfo is hard-blocked by the server for this mode. There is no contacts-enrich exception here (that is `section: contacts`, or a deep run). `credits_consuming_calls` MUST be `[]`.
3. **NO Playwright / LinkedIn** — hard-blocked. A page that needs a rendered browser gets a `sources_missing` entry with `kind: "attempted_failed"`; never a workaround.
4. **Stay inside the section list below.** Do not research firmographics, do not regenerate `messaging`, do not chase interesting tangents. Anything outside the list is what a deep run is for.
5. **Do not re-fetch what is already fresh.** Read the existing dossier first; a section whose own timestamp (`as_of` / `retrieved_at` / `generated_at`) is under 7 days old is skipped, not refreshed. Say which ones you skipped in the run note.

## Step 0 — Run log open

Append a run entry to `data/meta.json` `runs[]` (standard shape, `"mode": "brief"`). Finalize it at the end. Failures are loud in `errors[]`, never silent. `credits_consuming_calls` stays `[]`.

## Step 1 — Resolve the account and load any existing dossier

Resolve the account identifier from the run parameters against `data/index.json` to get the slug and canonical domain. Read `data/accounts/{slug}.json` if it exists.

- **Dossier exists** → this is a surgical update. Every key outside the section list stays **byte-identical**. Do NOT touch `refreshed_at`, `last_deep_refresh_at`, or `refresh_mode` — a brief run is not a full refresh, and `refresh_mode` only accepts `"light"` or `"deep"` per the schema. Section-level timestamps carry the freshness.
- **No dossier** → you are creating one. Fill every schema-required key: `schema_version`, `domain`, `slug`, `name`, `refreshed_at` (now), `refresh_mode: "light"` (NOT `"brief"` — the enum has no such value), `confidence`, `salesforce`, `firmographics`, `signals`, `news`, `icp_contacts`, `sources_missing`, `discrepancies`. Sections a brief run does not gather are written as empty/minimal-but-valid, never invented. `firmographics` gets categories from G2 plus whatever Salesforce already carries (`Industry`, `NumberOfEmployees`) — flag any headcount as `unverified_estimate`, since cross-checking it is a deep-run job (integrity rule 3).
- Check CLAUDE.md "Known account corrections" and apply any override, recording it in `corrections_applied`.

Also confirm the canonical domain still resolves — a 301 to a different domain means a rebrand, which invalidates every search below. Keep the existing index slug if so and note the rebrand in `discrepancies`.

## Step 2 — Salesforce (free, read-only)

Salesforce is **READ-ONLY** — integrity rule 11, no exceptions. Pull for this account:

- CRM history notes into `salesforce.crm_history_notes` — including closed-lost reason and date if any (a Closed-Lost account is a live winback target; check for a prior Closed Won before calling it churn).
- `Total_Vendor_Reviews_Last_60_Days__c` → `salesforce.reviews_last_60_days`.
- Open opportunities (`IsClosed = false`). **If the account has one, stop after writing the dossier and say so loudly in the run note** — an open opp is an AE's live deal and the account is not a prospecting target (integrity rule 13). No further sections are worth gathering.
- `LastActivityDate` in this org contains future dates (2029–2036) from scheduled sequence steps — never present it as a last touch, and never treat it as proof of employment (rule 4).

## Step 3 — G2 presence + intent (free)

G2 MCP **Server** tools only (`G2_MCP_Dev` variants permission-deny). Replace `g2`:

- `show_product` / `show_vendor` by slug → rating, review count, review recency, categories, `presence_summary`.
- Buyer-intent AGGREGATES via `browse_product_buyer_intent`: totals with `dimensions: "none"`, window with `dimensions: "month"` → `g2.buyer_intent.company_count` / `visitor_count` / `total_activity` and the real `since` date.
- **Counts only. Company NAMES never enter the dossier** — the feed carries reverse-IP noise, and named intent claims are seller-console-screenshot-only. Aggregates can be pure category traffic, so cite the actual `since` date and never phrase it as "companies read your reviews".

## Step 4 — News (free path, max 3 items)

WebSearch within `config.news.lookback_days` to discover items, then **WebFetch each source page** to confirm the date, publisher, and claim on the page itself — never from a search snippet. Cap at `config.brief.max_news_items` (3), newest and most material first. Replace `news[]`; append genuinely new material events to `signals[]` (never rewrite existing signal entries).

**On a cold start, `signals[]` must not come out empty.** "Append genuinely NEW events" has nothing to compare against when the dossier is being created from scratch, and an empty `signals[]` measurably weakens drafting: `draft.js`'s dossier-fact-priority rule reads `signals` when choosing a play and a fact, so an account with none falls back to a generic canonical stat instead of its own specifics. Seed it from what this run has already established — each material news item, the hiring direction and role mix from Step 5, and any closed-lost or prior-opportunity history from Step 2. A Closed Lost with a reason and a date is among the most useful signals in the file: it is what routes the winback play. Signals are things to PROBE, never verdicts (integrity rule 8).

Watch two known traps: a blog INDEX page can report different dates than the post's own page (confirm on the post), and bare `DD/MM/YY` on pt-BR newsrooms inverts the month — a future publication date means the parse failed, not the data.

## Step 5 — Hiring (free)

Careers page via WebFetch, or a public ATS JSON API when the board exposes one (Greenhouse/Workable). Open roles total, role mix, direction, as-of timestamp. Replace `hiring`. Hiring velocity beats headcount as a buying signal (rule 7) — capture the mix and direction, not just a number. Bot-blocked board → `sources_missing` `kind: "attempted_failed"`, move on.

## Step 6 — ICP contacts (free discovery only, ADDITIVE)

Existing `icp_contacts` entries are **never removed or rewritten** — their verification history is real. Add at most `config.brief.max_new_contacts` (8) new candidates found through free means only: the company's own leadership/about page (which routinely beats both SF and enrichment — it has caught a whole CCO+3-SVP bench that ZoomInfo missed), plus any Salesforce Contact rows on the account.

- Dedupe on `linkedin_url` first, then normalized name + similar title.
- Every contact added here is `verification.status: "unconfirmed"`, `method: "none"` — a brief run has no paid enrich and no LinkedIn, so it cannot confirm employment. The dashboard renders the "verify before outreach" badge; that is correct and expected.
- Salesforce `LastActivityDate` is NEVER verification (rule 4).
- A stale CRM row on a former employer's account is **not** evidence a contact is off-book — check this dossier's own `icp_contacts` before treating anyone as wrong-account.
- Note in the run entry that contacts are unconfirmed and a `section: contacts` run (capped paid enrich) or a deep run is the upgrade path.

## Step 7 — Write + validate

1. Apply the section replacements to a temp copy whose filename ends in `.json` (ajv treats `*.json.tmp` as JS and dies with "Unexpected token" — name it `*.tmp.json`).
2. Validate: `node server/scripts/validate-account.js <temp file>`. **Do NOT use `npx ajv-cli`** — it always fails behind G2's registry with `SELF_SIGNED_CERT_IN_CHAIN`. Fix every violation before writing.
3. Atomically replace `data/accounts/{slug}.json`.
4. Update the account's row in `data/index.json` if the brief produced a materially better `top_signal` (keep `status` and `open_opps` as-is — dropping `open_opps` would silently un-hide an AE's live deal).
5. Finalize the run entry: `finished`, `accounts_touched: ["<slug>"]`, `credits_consuming_calls: []`, and a one-line note naming which sections were refreshed, which were skipped as fresh, and whether contacts are unconfirmed.

`ai_visibility` is NOT your job — the server runs it directly after this job finishes (`config.ai_visibility.run_after_brief`), with no MCPs and no tokens from this run.

## Source discipline

Attempt every free source listed above before any fallback. Genuinely unavailable after a real attempt → record it in `sources_missing` and lower `confidence`; never silently skip. Research is not qualification (rule 8) — store signals as things to probe, not verdicts. Never report a headcount from a single enrichment source (rule 3); if the only number available is unverified, flag it `unverified_estimate`.
