---
name: storyline-mesh
description: Build account-level storyline outreach — one narrative spine per account, per-contact chapters, honest colleague cross-referencing, voice-correct drafts. Use whenever the task involves building a storyline, prepping an account batch, or drafting any prospect-facing outreach (emails, VMs, LinkedIn) for a named account, even if the word "storyline" never appears.
---

# Storyline Mesh (repo-local copy)

This is the Claude Code copy. The claude.ai copy bundles the rules files;
this one reads them live from the repo — they are the source of truth.

## Rule minus-one: read the repo before researching (cost gate, 2026-09-03)

The budget for this seat is $100/month; August was $2,652, and the single
largest slice was sessions re-researching accounts the pipeline had already
researched. For EVERY account on the work order, before any MCP call:

1. Read `data/accounts/<slug>.json`, `data/accounts/<slug>.storyline.json`,
   and the newest `data/drafts/research-*/<slug>.md`.
2. If the dossier's `refreshed_at` is under 30 days old, it is NOT re-researched.
   Research fills a named gap, nothing more.
3. Need fresh facts? Queue a cheap brief run and use what it writes:
   `curl -sX POST localhost:4680/api/refresh -H 'Content-Type: application/json' \
     -d '{"query":"<slug>","mode":"brief","origin":"user"}'`
   Brief is ~$0.30-0.60. A deep run is ~$8-11 and capped at 2/day.
4. New verified facts merge into the existing files as deltas — never a parallel
   dossier or a second storyline.

## Rule zero
Before drafting anything prospect-facing, read ALL of:
- data/plays/gates.md   (voice: six gates, we-we rule, say-it-positive, banned figures, scorecards)
- data/plays/anatomy.md (structure: E1 skeleton, continuations, VM, LinkedIn rules, word limits)
- data/plays/storyline.md (chapter discipline, claim gates, pairings, modes, verification gate)

## Depth mandate (revised 2026-09-03 — the old "token budget is unlimited" line is withdrawn)
Depth still matters; the budget is no longer unlimited, and "15-30 tool calls
per account is NORMAL" was written before the August bill. Spend the calls on
what the repo does NOT already have.

- Read first (Rule minus-one). Facts already in the dossier or storyline cost
  zero calls — re-pulling them is the specific waste this section used to cause.
- Attempt every relevant connector **for the gaps you actually identified**. An
  empty connector result on a real gap is information; a skipped connector on a
  real gap is a hole. A connector call that re-fetches a fact already on disk is
  neither — it is just spend.
- Every cast member still gets individually verified, and every load-bearing
  claim is still double-sourced or gated in `verification[]`. Those are
  correctness rules, not budget rules, and they do not relax.
- When a gap is broad rather than specific ("this account is stale"), that is a
  `brief` run's job, not a hand-research job.

## Research sequence (all of it, per account)
1. Salesforce: account + owner, all contacts (flag stale titles + dups),
   Task history 60-90d (prior hooks are BURNED; "Email: <<" = inbound; zero
   inbound = claims stay at "sent"), Closed Lost ops + loss reasons (route
   tone, never appear in copy). LastActivityDate is unreliable — use Task
   counts.
2. Gong: ask_account (past calls/threads, objections, resentment risks),
   ask_deal on prior opps. Gong history caps or upgrades claims entries.
3. ZoomInfo: enrich_company (never state headcount/revenue from one source);
   search_scoops (exec moves/funding/projects — dated scoops are storyline
   fuel); search_intent (corroboration only, never quoted as G2 data);
   enrich_contacts for EVERY cast member (accuracy 0 = likely departed);
   fill cast gaps via search_contacts + managementLevelList on companyName
   (companyWebsite search sometimes empty). No marketing decision-maker in
   cast = CAST GAP flag, pull leadership before spending the account.
4. G2 MCP: exact slug via list_products; reviews + rating (date-stamped);
   intent aggregates with signal_type split (counts in copy, NAMES
   quarantined until my.g2 seller-console screenshot; never sum
   company_count across signal types); comparison pairings BEFORE any E2
   that promises them; competitor review counts.
5. Web search: one targeted search per load-bearing theme (funding, execs,
   launches, partnerships) + web_fetch the actual article; company newsroom
   for their own framing; "reported" stays "reported"; LinkedIn only via
   indexed snippets, attributed probabilistically.
6. Slack: search the account name for internal context when available.

## Data integrity gates
1. Numbers in copy come only from dossiers/storylines with retrieval dates or tool calls made now.
2. G2 MCP intent COUNTS are cleared for copy; company NAMES quarantined until a seller-console screenshot exists.
3. Never mention or imply 6sense.
4. Colleague references capped by claims_ledger state (sent/replied/meeting/ae_thread_active). Never assert what a colleague thought unless they wrote it.
5. Unverified contacts go to the verification queue, never the send list.
6. State stat windows plainly; never juxtapose unequal windows as a trend.
7. Never state headcount/revenue from a single enrichment source.

## Files
- Storyline state: data/accounts/<index-slug>.storyline.json (slug = domain with
  dots→dashes; confirm against data/index.json — a wrong slug silently breaks
  the draft engine's loader).
- Send packages: data/drafts/storyline-sends-<date>.md
- Schema and full workflow: see the storyline files already in data/accounts/
  (cresta-com.storyline.json is the exemplar) and PLAN-STORYLINE.md.
