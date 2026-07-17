# Phase 7 Plan — approved 2026-07-16

Declan approved everything below ("I like everything you suggested"). Execute top-to-bottom;
each phase is independently shippable. Read `CLAUDE.md` first — every standing rule applies,
especially: n8n is an orchestrator, NEVER in the core pipeline (queue/cap guarantees live in
the server only); no LinkedIn automation in anything scheduled; Salesforce is read-only;
the chat backend is the only non-pipeline Anthropic caller (key in Keychain, LiteLLM proxy).

## 7A — Morning digest + failure alerts (n8n) — DO FIRST

The server already fires `run_finished` / `run_failed` webhooks (`config.server.webhooks`,
currently null; payload = job + ok + error + log path, see `fireWebhook` in `server/lib/queue.js`).

1. Declan sets up n8n (he has an API key; ask him where his n8n instance runs).
2. Failure alert workflow: `run_failed` → Slack DM (or email) immediately.
3. Morning digest workflow: after the nightly light run's `run_finished`, n8n pulls
   `GET /data/suggestions.json` + `GET /api/status` and formats: today's picks (with reasons),
   new signals in the last 24h (aggregate client-side from account JSONs OR add a cheap
   server endpoint `GET /api/whats-new?hours=24` that scans `data/accounts/*.json` signals/news
   timestamps — prefer the endpoint, n8n shouldn't crawl 450 files), failures, remaining deep cap.
4. May need the server to also fire a webhook on nightly completion specifically — the
   `run_finished` payload already carries `job.trigger` (`cron-nightly` / `catchup`), filter on that.
5. Verify: force a failure (bogus query) → Slack ping; run digest workflow manually against
   real data before trusting the schedule.

## 7B — Hyper-personalized per-contact messaging → Groove flow export (the outbound loop)

Goal: every verified contact leaves the pipeline with channel-ready, hyper-personalized
messaging, and one click produces a CSV that drops that messaging into a Clari Groove flow.
Groove then logs every send/call back to Salesforce as Tasks, which the `activity` mode
already reads — closing the loop (research → messaging → Groove execution → SF activity →
recency/don't-double-tap in the dashboard) with ZERO new write integrations.

**The join key is `salesforce_contact_id`** (already in `icp_contacts` schema). It links
ZoomInfo/LinkedIn verification → dossier → Groove CSV (keyed on Contact ID, not email) →
Groove's SF activity logging → our activity sidecar. No Groove API exists publicly (the
groovehq.com API is an unrelated help-desk product; Clari Groove automation is
partner-mediated — LeanData/Clay). CSV import is the supported, human-in-the-loop path and
the ONLY Groove integration we build.

Execution order (each step shippable alone):

1. **Schema (`schema/account.schema.json`):** extend `messaging` —
   - `openers` items become objects `{contact, channel, text, grounded_in}`;
     `channel` ∈ `call_opener` | `email` (then also `subject`) | `linkedin_note` (≤300 chars);
     email body ≤90 words. Keep backward compat: `items: anyOf[string, object]` — old
     dossiers have string openers; UI renders both.
   - add `messaging.objections: [{objection, grounded_in, response}]` (from Gong history).
   - `grounded_in` stays mandatory everywhere — every line traces to a stored signal.
2. **SF Contact ID backfill (pipeline, read-only):** when a contact is verified, SOQL the
   account's Contacts by email/name to populate `salesforce_contact_id` (cheap, free,
   read-only). Applies in deep runs AND the `contacts` section mode (its prompt should do the
   same lookup for the contacts it adds). Without it the Groove CSV falls back to email
   matching — works, but Contact ID prevents Groove Direct Import from creating duplicate
   SF records.
3. **Voice exemplars:** `prompts/style.md` — Declan pastes 3-5 of his best real emails
   (from Groove/Gmail, ones that got replies). Step 10 and the chat system prompt both load
   it ("write in this voice"). Ask Declan; don't invent them.
4. **Pipeline Step 10 rewrite (`prompts/refresh-account.md`):** per-contact messaging for
   VERIFIED contacts only (unconfirmed contacts get account-level angles, never personalized
   copy — don't polish messaging for someone who may have left). Personalization source
   hierarchy, most-specific wins: (a) contact-level facts — title/tenure/scope from the
   ZoomInfo or LinkedIn verification, their appearances in Gong history, their SF activity;
   (b) account signals — news, hiring velocity, G2 profile/review facts, Gong themes;
   (c) firmographics last. Standing rules apply: no G2 intent citations, no invented
   personal details, unverified estimates stay flagged.
5. **"Regenerate messaging" button:** `POST /api/messaging/:slug` — reuses the chat backend
   (`server/lib/chat.js` client; no MCPs; dossier from disk + style.md), writes ONLY the
   `messaging` section back (ajv-validate before atomic rename; bump `messaging.generated_at`).
   Cheap voice/angle iteration without a deep refresh. NOTE: first non-pipeline writer of
   account JSON — server-side, atomic, validated.
6. **Call-prep card (dashboard):** top of AccountDetail, one screen: verified contacts with
   their per-contact openers (copy-to-clipboard each), single best angle, 3 probes,
   last-touch recency (activity sidecar + `gong.summary`), staleness badge. Collapse the
   rest below.
7. **"Export to Groove" (dashboard, client-side — no server change):** button on AccountDetail
   + bulk variant on Today's picks. Generates a CSV download of VERIFIED contacts only
   (hard filter, not a checkbox): `Contact ID` (fallback `Email`), plus merge-field columns
   named exactly `flow.opener`, `flow.subject`, `flow.body`, `flow.ps` — Groove's CSV import
   maps `flow.*` columns to Custom Flow Merge Fields; templates reference `{!flow.opener}`
   (lowercase f, typed manually — not in Groove's insert menu). Column set is a documented
   contract in the export code; changing names silently breaks Declan's Groove templates.
8. **Groove side (Declan, one-time, manual):** build one flow template per step referencing
   the `{!flow.*}` fields; use "Complete merge fields" preview before first send; prefer
   matching existing SF contacts on import — Direct Import CAN create new SF contact records
   (that's Declan acting in Groove's UI, not our pipeline, but be deliberate).
9. **Close the loop / verify:** (a) regenerate messaging on 1-2 real accounts, eyeball vs
   old, ajv passes, old-format dossiers still render; (b) export a real CSV, import to a
   test flow, confirm merge fields populate in Groove's preview; (c) after a Groove send,
   run `activity` mode on that account and confirm the Groove-logged SF Task shows up →
   that's the don't-double-tap signal (7E) working end-to-end.

## 7C — More n8n workflows (after 7A, reuse its plumbing)

- **Inbound-lead auto-research:** n8n polls Salesforce (READ-ONLY — e.g. new campaign
  members / demo-request records on accounts in the book) → `POST /api/refresh`
  `{query: domain, mode: "deep"}` (origin omitted → auto → Playwright hard-blocked; correct).
  Cap/queue enforce themselves; 429 = normal, just log.
- **Meeting prep:** n8n watches Google Calendar → attendee domain in book + dossier stale
  (>7d?) → queue deep refresh (auto) evening before + send prep summary (digest format, one account).
- **Slack command:** `/research <domain>` → n8n → `POST /api/refresh` → reply in thread on
  the finished webhook.
- **Weekly rollup:** Monday morning — coverage (researched vs pending_research counts from
  index.json), credits used last 7d (meta.json runs), top picks.

## 7D — Papercuts (fold into any session)

- **Headless temp-file strays:** deep runs leave `data/accounts/{slug}.tmp-{job}.json` behind
  (mv/cp/rm all denied in some headless sessions; allow-rule `Bash(mv data/*)` matches
  inconsistently). Fix server-side: after each job exits, the server sweeps
  `data/accounts/*.tmp-*.json` older than the job start (log what it removed). Cleaner than
  fighting the sandbox.
- **Cap counter double-count** while a job is in flight (run entry + queue entry) — cosmetic,
  self-corrects; fix in `deepCapStatus` by excluding the running job's own run entry.
- **Chat conversations reset on navigation** — persist per-slug in sessionStorage.
- **Fan-out telemetry:** runs should note subagent wall-time savings in run notes (they already
  note fan-out engaged); keep an eye on whether ~20% holds; hiring subagent died once
  (2026-07-16 usebutton) — fallback worked, no action unless it recurs.
- **Dossier history for "what changed":** before overwriting an account JSON, copy the old one
  to `data/history/{slug}/{date}.json` (gitignored via data/) — prerequisite for the
  "what changed" panel (7E) and cheap to start collecting NOW.

## 7E — Content experiments (needs 7D history collection running first for the diff panel)

- "What changed since last refresh" panel (diff of signals/news/contacts vs previous version).
- Cross-book signals feed ("this week across my accounts") — client-side over index + accounts.
- Don't-double-tap warning: surface last-touch recency at the top of AccountDetail.
- Staleness badges + one-click re-run (>30d).
- Home "workbench": picks + in-flight + recently researched + stale-and-tier1.

## 7F — OPTIONAL: queue concurrency 2 for non-LinkedIn jobs (only if batch waits still hurt after 7C)

Today a 5-account batch ≈ 1.5h because the queue is serial; the last job waited 63 min to
start. Before building this, note 7C's pre-emptive research (inbound auto-research, meeting
prep, nightly picks) removes most of the perceived wait for free — do that first and see.

If still wanted:
- Prerequisite: shared-file write safety. Headless jobs currently Edit `data/meta.json` /
  `data/index.json` directly; two concurrent jobs would race. Move those writes behind the
  server (new endpoints: `POST /api/run-entry`, `POST /api/index-upsert` — server already
  serializes its own meta writes) and update `prompts/refresh-account.md` to POST instead of Edit.
- HARD RULE: LinkedIn jobs stay exclusive — never two concurrent (the dedicated Chrome
  profile is single-instance anyway, and parallel LinkedIn traffic is the restriction-risk
  pattern). Scheduler: a linkedin:true job runs alone; two linkedin:false jobs may overlap.
- Keep `deep_refresh_daily_cap` semantics unchanged (checked at enqueue, unaffected).
- Account files themselves don't conflict (one job per account; enqueue already dedupes).

## Facts a fresh session will want

- 5 boss-priority accounts researched 2026-07-16: instabase, exostar, matik.io, usebutton,
  resecurity (all deep, most with LinkedIn verify).
- Deep runs: ~15-26 min each; fan-out (subagents for G2/Gong/news/hiring) shipped 0f95b8a,
  confirmed engaging, ~20% faster so far; queue is serial by design — a batch of 5 takes ~1.5h.
- Chat/API plumbing for 7B.5 already exists in `server/lib/chat.js` (LiteLLM proxy,
  Keychain key, streaming, prompt caching verified).
- Groove facts (researched 2026-07-17): outreach runs on Clari Groove; flows accept CSV
  import with per-person Custom Flow Merge Fields — columns named `flow.<field>`, templates
  reference `{!flow.<field>}` (lowercase f, must be typed manually). CSV needs Email or
  SF Contact/Lead ID per row; "Direct Import" can CREATE SF contacts (admin-enabled — use
  deliberately). Groove logs sends/calls to SF as Tasks → our `activity` mode reads them
  back. No usable public Clari Groove API (groovehq.com ≠ Clari Groove); don't build API
  integrations. Docs: clari.my.site.com Knowledge articles "Custom Flow Merge Fields",
  "Adding Contacts and Leads From a CSV File".
