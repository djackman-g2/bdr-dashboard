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

## 7B — Call-prep card + per-contact messaging (they feed each other)

1. **Per-contact messaging (pipeline change, `prompts/refresh-account.md` Step 10):**
   messaging angles/openers become per-contact where contacts exist — each opener tagged with
   the target contact + channel variant (cold-call opener; email subject + ≤90-word body;
   LinkedIn note ≤300 chars). Keep `grounded_in` mandatory. Schema change: extend
   `messaging` in `schema/account.schema.json` (openers become objects: `{contact, channel, text}`;
   keep backward compat — old dossiers have string openers; UI must render both).
2. **Voice exemplars:** new file `prompts/style.md` (gitignore-check: fine to commit, no secrets) —
   Declan pastes 3-5 of his best real emails; Step 10 and the chat system prompt both load it
   ("write in this voice"). Ask Declan for the emails; don't invent them.
3. **Objection prep:** Step 10 addition — from Gong history objections, generate
   `messaging.objections: [{objection, grounded_in, response}]`. Schema + UI section.
4. **Call-prep card (dashboard):** new component at the top of AccountDetail, one screen:
   verified-only contacts (+ their per-contact openers), single best angle, 3 probes,
   last-touch recency (from `gong.summary` / `salesforce.crm_history_notes`), staleness badge.
   Collapse everything else below. Copy-to-clipboard on openers.
5. **"Regenerate messaging" button:** new endpoint `POST /api/messaging/:slug` — reuses the
   chat backend (`server/lib/chat.js` client; no MCPs, dossier from disk, style.md included),
   writes ONLY the `messaging` section back to the dossier (validate with ajv before rename;
   bump a `messaging.generated_at`). Cheap alternative to a full deep refresh. NOTE: this is
   the first non-pipeline writer of account JSON — keep it server-side, atomic, validated.
6. Verify: regenerate on 1-2 real accounts, eyeball quality vs old messaging; ajv passes;
   old-format dossiers still render.

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

## Facts a fresh session will want

- 5 boss-priority accounts researched 2026-07-16: instabase, exostar, matik.io, usebutton,
  resecurity (all deep, most with LinkedIn verify).
- Deep runs: ~15-26 min each; fan-out (subagents for G2/Gong/news/hiring) shipped 0f95b8a,
  confirmed engaging, ~20% faster so far; queue is serial by design — a batch of 5 takes ~1.5h.
- Chat/API plumbing for 7B.5 already exists in `server/lib/chat.js` (LiteLLM proxy,
  Keychain key, streaming, prompt caching verified).
