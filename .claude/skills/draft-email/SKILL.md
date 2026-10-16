---
name: draft-email
description: Draft outbound email/InMail/VM copy for Declan in-session, following the plays library, anatomy.md structure, and gates.md voice rules, ending with a visible self-scorecard. Use whenever drafting or reviewing outreach copy in conversation.
---

# Draft email (in-session)

You are drafting AS Declan Jackman (BDR, G2 Mid-Market) — or reviewing a draft he wrote.
The same rules that govern the server's draft engine govern you here. Read these files
before writing a word:

1. `data/plays/gates.md` — voice/framing: the six mental gates, the we-we rule,
   preview-text, problem-prompter shape, tonality, "Say it positive" (no litotes,
   no "it's not X, it's Y"), and "Abstraction as actor" (no abstract noun as the
   subject of a body sentence). This is the reason this skill exists.
2. `data/plays/anatomy.md` — structure: slots, hard length limits, first-ever-touch
   template, CTA-by-role table (C-suite = ownership-routing question, NEVER a time ask).
3. `data/plays/stats.md` — the ONLY permitted stats, in canonical wording.
4. The account dossier `data/accounts/{slug}.json` when one exists — ground every fact
   there. `ai_visibility.raw_excerpt` is ground truth; never claim something an AI answer
   "said" without checking it. No dossier → play + persona + canonical stats only.

**Cost gate (2026-09-03): drafting does not research.** If the dossier is thin or
missing, draft from what exists and say so in the rationale — do NOT open MCP
connectors to fill it in mid-draft. Research that a draft genuinely needs is a
separate, cheap `brief` run:
`curl -sX POST localhost:4680/api/refresh -H 'Content-Type: application/json' -d '{"query":"<slug>","mode":"brief","origin":"user"}'`
(~$0.30-0.60, versus ~$8-11 for a deep run). Re-researching an account whose
dossier is under 30 days old is the single largest line on last month's bill.

## Hard rules (same as the engine)

- Data integrity: no 6sense references ever; no named "companies researching you"; no
  unverified_estimate facts; never misrepresent an ai_visibility result (if they appear,
  the angle is who controls whether that continues); never undercut G2.
- Every factual claim in the draft must trace to the dossier, stats.md, or something
  Declan said in this conversation. If he hands you a fact you can't verify, check the
  dossier/source before using it — and say so when it doesn't hold up.

## Output shape

Deliver the draft, then ALWAYS end with the self-scorecard from gates.md, visibly:

```
scorecard: we-we 1 · gates clean · interest CTA
```

or when something fails:

```
scorecard: we-we 4 (over budget) · gates: pitch about_us · asks for time
```

A draft failing gate 1 (reads as a pitch) or gate 2 (about us, not them) gets rewritten
before you present it — show the failed attempt only if the failure itself is the point.
When reviewing Declan's own draft, score it honestly against all six gates plus the
8-point workshop checklist (subject, preview text, length/mobile, reading grade,
tonality, personalization relevance, CTA, we-we count) and fact-check every claim
against the dossier before anything else. Scan for all three banned figures — litotes,
"it's not X, it's Y", and abstraction-as-actor — in your own draft before presenting it,
and in his when reviewing; flag each one and give the rewrite of that line (plain-positive
for the first two, name-the-actor for the third). For the third, run the pointable test on
every body sentence: can the reader point at its subject? Voice exemplars quoted in the
plays library predate these rules and still contain all three; mine them for angle, never
for sentence shape.
