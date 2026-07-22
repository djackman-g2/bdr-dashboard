# Phase 7G Plan — FY27 universe + outbound scale addendum (drafted 2026-07-21)

Extends the approved Phase 7 plan. SF facts below (field API names, account counts, WHERE
clause) were verified live against the org on 2026-07-21 — trust them over older session
facts. Read `CLAUDE.md` first — every standing rule applies
(Salesforce read-only; no LinkedIn in scheduled runs; no G2 intent citations in outreach;
grounded_in mandatory on every messaging line; key material in Keychain only).

Sequencing: **7G-0 FIRST — it is a prerequisite for everything** (wrong universe = wasted
runs on 163 accounts that left the book). 7G-1 can ship before or alongside 7B (it feeds
7B's messaging step). 7G-2 amends 7B steps 1 and 4 — fold it in rather than doing 7B twice.
7G-3 depends on 7G-2's persona library but NOT on 7B's contact verification work.

## 7G-0 — Universe correction + 6sense-powered ranking (DO FIRST, one session)

Territory changed for FY27. Verified against SF 2026-07-21: the old universe query
(`BDR__c` alone) returns 452, but ~163 of those are owned by other AEs (Taylor Worthy 82,
Courtney Potter 69, 2 strays) pending reassignment. The real book is **289 accounts**,
reproduced exactly by the FY27 report filter.

1. **`config.json` — new universe:**
   ```
   "account_universe_where": "BDR__c = '005Nw000003GH6PIAW' AND Owner.Name IN ('Sean Mahoney','Nick Cantieri') AND Type = 'Vendor - Prospect' AND Is_Ultimate_Parent_Account__c = true"
   ```
   Update the adjacent `notes` (still mention the future-dated LastActivityDate quirk; add
   that non-ultimate-parent children and other-AE accounts are excluded by design — if the
   book shifts again, this WHERE clause is the single thing to edit).
2. **`config.json` — add to `account_fields`** (API names verified against FieldDefinition
   2026-07-21):
   ```
   X6sense_Account_Buying_Stage__c, X6sense_Account_Intent_Score__c, X6sense_6QA__c,
   Total_Hierarchy_ACV__c, Total_Hierarchy_SOM__c, Available_SOM__c,
   Number_Active_Products_In_Hierarchy__c, Number_of_Claimed_Profiles__c,
   Profile_Completeness_Percent__c, Total_Vendor_Reviews_Last_60_Days__c
   ```
3. **Schema:** extend `salesforce` section with matching snake_case optional fields
   (`buying_stage_6sense`, `intent_score_6sense`, `is_6qa`, `total_hierarchy_acv`,
   `total_hierarchy_som`, `available_som`, `active_products_in_hierarchy`,
   `claimed_profiles`, `profile_completeness_pct`, `reviews_last_60_days`).
   `salesforce` already allows `additionalProperties: true`, so old dossiers stay valid;
   adding named properties documents the contract for the UI.
4. **`prompts/refresh-all-light.md` Step 3 — rebuild the ranking tiers** (all free SOQL,
   already in the universe pull — no extra calls):
   1. Open opportunity (unchanged, largest amount first)
   2. 6sense Buying Stage = `Purchase`, then `Decision` (intent score desc within stage)
   3. 6sense Intent Score desc (nonzero), 6QA-flagged accounts first
   4. Buying Stage = `Consideration`, `Available_SOM__c` desc within
   5. Recent REAL CRM activity (≤ today, last 90d — future-date rule unchanged)
   6. Alphabetical
   **DELETE the G2 `browse_buyer_intent` tier entirely** — tenant-scoping bug stands
   (CLAUDE.md connector table); 6sense-from-SF replaces it with working data at zero cost.
   Update `suggestions.json` tier enum accordingly:
   `open_opp | stage_purchase | stage_decision | intent_6sense | consideration_som |
   recent_activity | alphabetical` — reasons must carry the number ("6sense intent 78,
   stage Decision"). `TodaysPicks.jsx` renders whatever reason string arrives; update its
   tier badge map.
5. **Standing rule (add to CLAUDE.md data-integrity rules):** 6sense intent/stage is a
   PRIORITIZATION signal only — never referenced or implied in outreach copy ("noticed
   you've been researching…" is prohibited). It ranks who to work; public signals (news,
   hiring, G2 profile, ai_visibility) supply what to say. Messaging generation must not
   consume the 6sense fields.
6. **CLAUDE.md "Session facts" update (same commit):** universe is 289 (down from 452),
   new WHERE clause, FY27 AE pairing Sean Mahoney + Nick Cantieri, ~163 legacy accounts
   auto-archive on the next light run. Without this, future headless runs flag phantom
   ±20% count anomalies against stale facts.
7. **Verify:** run a light refresh → index reconciles to 289 active, ~163 newly archived
   (never deleted), the ±20% warning fires once with a note pointing at this change,
   `suggestions.json` shows the new tiers, and the top of the list is dominated by the
   Purchase/Decision accounts (17 as of 2026-07-21).

Book snapshot for sanity-checking (from the 2026-07-21 report): 289 accounts; buying
stages — Purchase 4, Decision 13, Consideration 43, Awareness 76, Target 152; 136 with
nonzero intent score; 10 with open opps (Shift4, Cresta, Revenera, Elemica, Socure,
GlossGenius, You, Measured, Omeda, Zonar Systems).

## 7G-1 — AI-visibility module (the AEO play, automated)

Goal: every account dossier answers "does this company show up when a buyer asks an LLM
for a shortlist in their category — and who gets cited?" This is the raw material for the
best-performing subject line ("Looked up {company} on ChatGPT") and it currently gets
produced by hand, per account, at send time.

1. **Schema:** new top-level optional section `ai_visibility`:
   - `queries: [{prompt, ran_at, model, company_appeared: bool, companies_returned: [string],
     g2_cited: bool, sources_cited: [string], raw_excerpt}]`
   - `summary: string|null` — one line, the wedge ("absent from all 3 shortlist queries;
     Competitor X appears in 3/3; G2 cited in 2/3")
   - `as_of: date-time`
   Not in `required` — old dossiers stay valid, no migration.
2. **Runner:** reuse the chat backend client (`server/lib/chat.js` — LiteLLM proxy, Keychain
   key). NOT an MCP call, NOT part of headless Claude's tool surface: a plain server-side
   function `lib/aiVisibility.js` that sends 2-3 canned prompts and parses the responses.
   Canned prompts, built from dossier data already on disk:
   - "What are the best {g2.products[0].categories[0]} tools?" (shortlist)
   - "Compare {name} vs {top competitor}" (head-to-head; competitor from g2 categories —
     if unknown, skip this query, never invent a competitor)
   - Optional: "{name} reviews" (citation check)
   Parsing: company_appeared = name/domain match in response; sources_cited = URLs/domains
   mentioned. Store the raw excerpt — the dashboard renders it, and it's screenshot-equivalent
   evidence for the email.
3. **Exposure:** (a) new `section` mode value `ai_visibility` — but since the runner is
   server-side (no MCPs needed), implement as a direct endpoint `POST /api/ai-visibility/:slug`
   like 7B.5's messaging regenerate (ajv-validate, atomic write, section-only). Cheap enough
   to also run automatically inside every deep refresh (server runs it after the pipeline
   job finishes, before marking the run done). (b) Dashboard: small card in AccountDetail —
   appeared/absent badge per query, cited sources, raw excerpt expandable, ⟳ header button.
4. **Messaging hook:** 7B Step 10's personalization hierarchy gains a tier between contact
   facts and account signals: for marketing/C-suite personas, `ai_visibility.summary` is the
   default opener fact when present. `grounded_in: "ai_visibility"` traces it.
5. **Honesty rule (non-negotiable):** if the company DOES appear in the shortlist, the angle
   flips to "you're showing up — here's who controls whether that continues" — never
   misrepresent the result. `company_appeared` is data, not copy.
6. Verify: run on the 5 researched accounts; eyeball raw excerpts vs what a manual ChatGPT
   check shows; confirm old dossiers still validate.

Cost note: 2-3 small completions per account through the proxy. Negligible vs a deep
refresh; fine to include in nightly-adjacent automation later (7C digest could flag
"accounts that dropped out of shortlists" — deferred).

## 7G-2 — Persona layer (amend 7B before executing it)

Goal: personalization effort happens once per PERSONA, not once per contact. Contact-level
copy = persona skeleton × account payload × contact facts.

1. **Schema:** `icp_contacts[].persona`: enum
   `marketing_leader | demand_gen | pmm | revops_sales_leader | seo_aeo | partnerships |
   customer_marketing | founder_exec | other` (nullable; assigned at verification time from
   title/department; `other` never gets per-contact copy without a manual look).
2. **`prompts/personas.md`** (companion to 7B.3's `style.md`): one block per persona —
   who they are, what they care about, which dossier facts rank highest for them, angle
   (AEO for marketing_leader/pmm/founder_exec/seo_aeo; buyer-intent-value-WITHOUT-citing-
   intent-rows for demand_gen/revops_sales_leader — hiring velocity, review momentum, G2
   profile gaps; co-sell/ecosystem for partnerships), subject-line pattern, CTA style.
   Source material: the existing cold-call frameworks and callback playbook — port, don't
   reinvent. Declan reviews/edits this file by hand; it is voice-adjacent like style.md.
3. **7B Step 10 amendment:** messaging generation loads `style.md` + `personas.md`; every
   generated opener/email records `persona` alongside `grounded_in`. Contacts with
   persona=null/other get account-level angles only.
4. **Groove contract unchanged:** still `flow.opener/subject/body/ps` — personas change what
   fills the columns, not the column set. One Groove flow per persona (Declan, manual,
   one-time) instead of one generic flow; the CSV export gains a persona column used only
   to split the export into per-flow files (`{slug}-{persona}.csv`), since one Groove import
   targets one flow.

## 7G-3 — Messaging-lite tier (coverage for the long tail)

Problem: messaging is deep-only; deep is 15-26 min, capped 10/day, serial → 289 accounts
(post-7G-0 universe) never get covered. The long tail needs sendable account-level persona emails WITHOUT
credits, verification, or Playwright.

1. **New mode `messaging-lite`** (per-account, prompt `prompts/refresh-messaging-lite.md`):
   free tools only, hard rules identical to `section` mode (no ZoomInfo, no Playwright,
   15-min timeout). Pipeline: SF basics (already synced) → public G2 `show_product`/
   `show_vendor` → server-side ai_visibility run (7G-1) → ONE news search pass (free path)
   → generate account-level messaging per persona (no named contacts, no per-contact copy)
   → write a REDUCED dossier: required sections + g2 + ai_visibility + messaging,
   `confidence: "low"`, `refresh_mode` gains enum value `"messaging_lite"` (schema change),
   index `status` gains `"lite_researched"` so Today's Picks and the workbench can
   distinguish it from real research.
2. **Contacts for lite accounts:** come from SF contacts already on the account, exported
   with the STANDING unverified caveat — Groove CSV export for lite accounts filters to
   contacts with an email in SF and stamps `flow.opener` etc. from the ACCOUNT-level persona
   copy. This knowingly relaxes 7B's verified-only export rule for lite accounts — make it
   a separate export button ("Export lite — unverified contacts") so it is never the default
   path, and the CSV filename says `-UNVERIFIED`. Rule 4 still applies in spirit: lite copy
   contains nothing person-specific, so a departed contact costs a bounce, not an
   embarrassment. Declan accepts bounce risk explicitly per export.
3. **Batching:** `POST /api/refresh` accepts mode `messaging-lite`; nightly ranking gains a
   config flag `refresh.auto_queue_lite` (default false initially; intended true once
   verified) with its own daily cap `lite_daily_cap` (suggest 25 — token cost only). At 25/day
   the whole 289-account book has sendable persona messaging in ~12 days, refreshing
   oldest-first after.
4. Verify: lite-run 5 accounts from the alphabetical tier; confirm dossiers validate, copy
   quality is acceptable for a template-tier send, and a lite CSV imports into a test flow.

## Explicitly NOT doing (memo ideas rejected, with reasons)

- **Auto-sending email:** Groove is the send/log layer, human-in-the-loop by design (7B).
  No SMTP, no Gmail-API sending from the pipeline. The CSV is the boundary.
- **Citing G2 buyer-intent rows in any copy:** tenant-scoping bug stands (CLAUDE.md
  connector table). Revisit only after `list_my_products` returns data AND a seller-console
  cross-check passes. Track separately: ping G2 MCP owners about seller scoping.
- **Prospect enrichers / new tools (Clay etc.):** the stack already covers discovery
  (ZoomInfo search_contacts, free) + verification (enrich_contacts/LinkedIn). The bottleneck
  was messaging throughput, which 7G-2/7G-3 fix. Re-evaluate only if contact discovery
  becomes the measured bottleneck.
- **Sales Nav as the contact front door:** demote to exception handling. Deep runs source
  contacts from ZoomInfo free search + SF, verify per standing rules; Sales Nav (via the
  Playwright session, same constraints) only for contacts ZI can't confirm.

## Metrics to watch (add to run notes / weekly rollup in 7C)

- Coverage: accounts with sendable messaging (deep + lite) vs 289 (post-7G-0 universe).
- Per-send effort: time from "pick account" to "CSV imported" (target: minutes).
- Reply rate by persona and by tier (deep vs lite) — Groove reports; if lite replies ≈ deep
  replies, deep messaging effort should shrink further. Opens without replies on AEO sends →
  test the withhold variant (name the finding, don't show the screenshot; screenshot becomes
  the reward for the reply/call).
- Open-triggered dialing: Groove open events are the call trigger — surface "opened in the
  last 24h, not yet called" on the workbench (fold into 7E).
