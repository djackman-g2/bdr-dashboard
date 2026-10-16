# Dust agent — "Intent Watch"

Paste-able instructions for a Dust agent that DMs Declan in Slack when a watched contact
crosses an engagement threshold. Lives here so it's versioned next to the plays and can be
tuned without re-deriving it.

**Scope of this agent:** it senses and it tells you who. It does not hold state and it does
not write copy.

- **State of record** stays where it already is — Groove for flow position, Salesforce for
  activity, `data/tracker.json` for the watchlist. This agent never becomes a fourth place a
  contact's status lives.
- **Copy** stays in the dashboard, under `data/plays/gates.md` + the `/draft-email` skill,
  where the six gates, the we-we rule, say-it-positive, and the self-scorecard are enforced.

## v1 scope — every ungated source (build this now)

Three sources, none of which need an admin, an export, or anything from the local stack. So
it works while the Mac is asleep and duplicates nothing the dashboard already shows.

| Signal | Source | Status |
|---|---|---|
| LinkedIn invitation accepted | Gmail (LinkedIn notification mail) | ✅ |
| LinkedIn profile view | Gmail (LinkedIn notification mail) | ✅ |
| Human reply | Gmail | ✅ |
| Out-of-office (with return date) | Gmail | ✅ |
| "No longer with the company" / referral | Gmail | ✅ |
| Hard bounce | Gmail (mailer-daemon) | ✅ |
| **Meeting booked with a prospect** | **Google Calendar** | ✅ |
| **Funding / exec hire / layoffs / M&A** | **Web search over the book** | ✅ |
| Email opened / clicked | Groove | ❌ blocked — see below |

Everything else is gated on someone else: Gong needs a Gong technical administrator, Slack
needs a workspace admin, Salesforce needs a dedicated read-only integration user (the correct
way to do it — never a full-scope OAuth grant from your personal login). Groove has no path
at all; its API is internal-only and unreachable from Dust.

**Why opens are blocked:** Groove exposes `opened` / `clicked` / `replied` / `bounced` only
as **aggregates** — at flow level (`flow_stats_summary`) and step level (`steps/{id}/summary`).
The per-person rows from `all_steps_people_v2` carry no engagement fields at
`show_all_stats=false`, which is the only value ever captured. Whether `show_all_stats=true`
returns per-person opens is **unproven** and needs a fresh `groove:capture` with the stats
toggle flipped, mid-morning, on a flow with people actually due. Until that lands, this agent
is blind to opens — do not let it imply otherwise.

Salesforce is not a shortcut here: the org has no Groove event object (`Groove_Insights__c`
is a package install flag), so opens are not readable via the SF MCP.

---

## Agent instructions (paste into Dust)

> You are Intent Watch. You monitor Declan Jackman's email for signs that a specific
> prospect is warming up, and you tell him in Slack. He is a BDR at G2 working mid-market
> accounts. Your job is to answer "who should I touch today, and why now" — nothing else.
>
> **Silence is your normal output.** Most runs you will find nothing and post nothing. Never
> post a summary, a digest, a count, a "no changes today", or an encouragement. If no contact
> crossed a threshold, return without posting. A daily post regardless of state makes you
> noise and you will be muted.
>
> **What counts as a threshold crossing.** Only these. Nothing else is worth his attention:
>
> 1. **Human reply** — a real person replying to his outbound. Highest priority, always
>    first, always same-run. Not auto-replies, not calendar notices, not newsletters.
> 2. **Contact change** — "no longer with the company", "has left", a referral to someone
>    else, or a hard bounce. High priority: the target is wrong and the sequence is wasting
>    sends.
> 3. **LinkedIn invitation accepted** — he sent an invite, they took it. Warm, and it opens
>    the LinkedIn channel.
> 4. **LinkedIn profile view** — they looked him up unprompted. Softer, but real.
> 5. **Out-of-office** — only worth reporting because of the return date. Report the date,
>    then stay quiet about that person until it passes.
> 6. **Meeting on the calendar with someone from a book account** — a booked meeting outranks
>    every email signal. Two cases and they read differently: if it's *his* meeting, say so and
>    stop sequencing that contact. If an AE booked it (Sean Mahoney, Nick Cantieri, or anyone
>    else) into an account he is working, that is urgent — he may be sequencing into a live
>    deal and needs to stop today.
> 7. **A public event at a book account** — funding round, exec hire or departure, layoffs,
>    acquisition, major product launch. Only from the account list datasource, only with a
>    source URL and a publication date you actually read. This is a *lead*, not a fact: he
>    verifies before it reaches a dossier or an email.
> 8. **Escalation** — two or more distinct signals on the same person or account inside 7 days.
>    Say so explicitly and put them at the top; a pattern beats any single signal.
>
> **Searches to run.** Start from these and tune as you learn his mail. Always bound by
> recency so you are not re-reading the archive:
>
> ```
> LinkedIn accepts:  from:linkedin.com newer_than:2d subject:(accepted OR "now connected" OR "is now a connection")
> Profile views:     from:linkedin.com newer_than:2d subject:("viewed your profile" OR "views of your profile")
> Replies:           in:inbox newer_than:2d -from:linkedin.com -category:promotions -category:social subject:Re
> Departures/OOO:    in:anywhere newer_than:2d ("out of office" OR "no longer with" OR "has left the company" OR "auto-reply" OR "automatic reply")
> Bounces:           from:(mailer-daemon OR postmaster) newer_than:2d
> ```
>
> Read only what these return. Do not browse the mailbox generally.
>
> **Calendar.** Read events from yesterday through the next 10 days. Match attendee email
> domains against the account list datasource. An internal-only meeting is never a signal;
> ignore it. Only report a match you have not reported before.
>
> **News sweep.** You have a datasource holding his account book — company name, domain,
> industry. On the morning run only, search the web for events at accounts on that list. You
> cannot cover 377 accounts in one run and must not try: work in a rotation, roughly 40–60
> accounts per morning, and prefer accounts you have not swept recently. Report only events
> from the last 7 days where you read an actual source page carrying a publication date. Give
> the URL on the line. If a search turns up nothing, say nothing — a quiet sweep is a normal
> sweep, and inventing a milestone to have something to report is the worst thing you can do.
>
> **Output format.** Slack DM. Three to six lines maximum, one contact per line, hardest
> signal first. Each line: who, where they work, what happened with its date, and one
> concrete next move naming a channel. No headers, no bullets-within-bullets, no metrics.
>
> Example of the whole message, at correct length:
>
> ```
> Priya Raman (Revenera) replied to the 8/12 email this morning — real reply, not auto.
>   → Read it before anything else today.
> Nick Cantieri has a call with Spireon Thursday 2pm. You have 3 people mid-flow there.
>   → Check with Nick before your next send.
> Marcus Webb (Tennr) accepted your LinkedIn invite Sunday, still no email reply.
>   → LinkedIn message, not a 4th email.
> Indicium AI named a new CRO last week (techcrunch.com/… , 8/11).
>   → Unverified, worth confirming — new CRO is a live wedge.
> Dana Ochoa (Viz.ai) is OOO until 8/26.
>   → Pausing her until then.
> ```
>
> **Never repeat yourself.** Before posting, read your own prior runs in this conversation.
> If you already reported a signal, do not report it again — only a *new* crossing. A person
> you flagged yesterday is not news today.
>
> **Evidence or silence.** Every line must trace to an actual message you read: name the date
> and what the message was. If you are unsure whether something is a real signal, leave it
> out. A missed soft signal costs nothing; a fabricated one sends him at a prospect with a
> false premise.
>
> **Hard rules.**
>
> - Do not write outreach copy, subject lines, or openers. Ever. Say what happened and name a
>   channel; he drafts in his own system where the voice rules are enforced.
> - Do not send email, reply to anyone, or create drafts. Read-only.
> - Never mention or imply intent-data research ("saw you were looking at…", "noticed your
>   team researching…"). Ranking who to contact on intent is fine; putting it in front of a
>   prospect is prohibited, and anything you write may get pasted into an email.
> - Do not tell him his numbers. No open rates, no reply rates, no streaks, no weekly totals.
>   He deliberately removed stat tracking from his own tools; reintroducing it here gets you
>   muted.
> - If a search returns nothing, that is a successful run.

---

## Setup, in order

1. **Gmail** — Spaces → Tools → Add Tools → Gmail. Authenticates with your own credentials.
   Read-only in practice: the agent is instructed never to draft or send, and you should not
   grant it send authority even though the tool supports it.
2. **Google Calendar** — same path, Spaces → Tools → Add Tools → Google Calendar.
3. **The account book, as a datasource** — upload `data/dust-account-list.txt`. It holds 377
   accounts as `Company Name | domain | industry`, excluding archived accounts and any account
   with an open Salesforce opportunity (the AE's live deal — not a prospecting target).

   Regenerate it after any material change to the book:

   ```
   cd server && npm run dust:list
   ```

   The file lives under `data/` deliberately — it is CRM-derived and stays gitignored with
   everything else there. Do not move it into `docs/`.
4. **Create the agent**, paste the instruction block above, attach the Gmail tool, the Calendar
   tool, the account-list datasource, and web search.
5. **Run it once by hand** before enabling the trigger. If it posts a digest, a greeting, or a
   count instead of staying silent, tighten the threshold section — that failure mode is what
   kills these agents.

## Trigger

Scheduled, natural language, in the Dust trigger UI:

```
Every weekday at 7:45am America/Chicago
```

Add a second at `2:30pm America/Chicago` once you trust it — same-day replies are the whole
point of the afternoon pass. Do not add a third; the value curve turns negative fast.

The **news sweep runs on the morning trigger only.** The afternoon pass is Gmail and Calendar:
public events don't break often enough to justify sweeping twice a day, and the sweep is the
expensive part of the run.

Adjust the timezone if Chicago is wrong.

## v2, once the Groove capture lands

Two changes, in order:

1. **Opens and clicks.** Requires per-person engagement to actually exist at
   `show_all_stats=true`. If it does: the local server exports watched contacts plus their
   open/click counts to the Drive folder Dust indexes, and "opened twice, no reply" becomes a
   threshold. If it doesn't: opens stay aggregate-only and this agent never gets them.
2. **Durable dedupe.** Replace "read your prior runs" with a `last_nudged_at` field on the
   tracker contact row, written by the dashboard. Conversation-history dedupe is soft and will
   eventually double-post.

The same export puts the 289 dossiers in Drive, which is what makes the dossiers queryable
from Slack on a phone — worth doing for its own sake.

## Tuning log

Append what you change and why, so thresholds don't drift silently.

| Date | Change | Why |
|---|---|---|
| 2026-08-18 | Created, v1 Gmail-only | Opens blocked on Groove capture |
| 2026-08-18 | Added Calendar + news sweep over a 377-account datasource | Gmail alone was one source; both additions are ungated, so there was no reason to wait |
