# BDR Account Research Dashboard

Local, auto-updating account research dashboard for prospecting, outbounding, and
pre-call prep. Built by/for Declan Jackman (G2 Mid-Market BDR), runs entirely on
localhost. Full architecture, data-integrity rules, and operational history live in
[CLAUDE.md](CLAUDE.md) — read that before touching the pipeline.

## What's in the box (and what isn't)

Four layers: a Claude Code research pipeline (the only thing that calls MCP tools) →
JSON dossiers on disk under `data/` → an Express server (queue, cron, SSE) → a
Vite/React dashboard.

**A fresh clone contains code only.** `data/` is gitignored (ZoomInfo-derived
contacts, CRM notes — never pushed) except `data/personas.js`. All credentials live
in the macOS Keychain or claude.ai-hosted connectors, never in the repo. So out of
the box you get an empty-but-working dashboard; research data populates only if you
run the pipeline with your own connector access.

## Quickstart

Requires Node 20+ and macOS (Keychain is assumed for the optional keys).

```sh
# 1. Server
cd server && npm ci

# 2. Dashboard (server serves the built dist/)
cd ../dashboard && npm ci && npm run build

# 3. Run
cd ../server && npm start
# → http://127.0.0.1:4680
```

`npm run dev` in `dashboard/` gives you hot reload; API calls proxy to the server if
it's running, otherwise the UI stays read-only.

## Works without any credentials

- The dashboard UI, tracker views (`#/activity`, `#/accounts`, `#/day`), and the
  activity bar — the tracker is manual-entry, stored in `data/tracker.json`.
- The plays/hook-angle system (`data/plays/*.md`) — deterministic templates, no LLM.

## Needs credentials

| Feature | Needs | Where |
|---|---|---|
| "Ask Claude" chat panel, AI-visibility card | Anthropic-compatible API key (G2 folks: LiteLLM proxy virtual key) | Keychain: `security add-generic-password -a "$USER" -s bdr-dashboard-anthropic -w` |
| Community chatter (Reddit half) | Reddit script-app creds as `client_id:client_secret` | Keychain service `bdr-dashboard-reddit` |
| Research pipeline (light/deep/section refreshes) | Claude Code + claude.ai connectors: Salesforce (reads), ZoomInfo, G2, Gong | Your own claude.ai account; headless allowlist is in `.claude/settings.json` |
| LinkedIn verification (deep refresh opt-in) | Dedicated Playwright Chrome profile | `cd server && npm run linkedin:login` — see CLAUDE.md, there are sharp edges |

`config/config.json` is where everything tunable lives (port, SOQL universe clause,
caps, cron). If you're pointing this at your own book of accounts, the Salesforce
`account_universe_where` clause is the single thing to edit.

## Non-negotiables

If you run the pipeline against real connectors, the data-integrity rules in
CLAUDE.md apply — the short version: **Salesforce is read-only, always**; ZoomInfo
paid calls are domain-keyed and logged; 6sense intent never appears in outreach
copy; G2 buyer-intent company lists are suspect and never cited in messaging;
LinkedIn automation stays low-volume, deep-refresh-only, opt-in per run.
