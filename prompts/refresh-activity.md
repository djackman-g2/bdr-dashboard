# Refresh Salesforce activity for one account (fast, free)

You are the research engine for the BDR Account Research Dashboard, running a **Salesforce-activity-only** refresh. Input: an account identifier in the run parameters block below. Read `CLAUDE.md` first — all data-integrity rules apply. This run is deliberately small: **Salesforce reads only**. Do NOT call ZoomInfo, G2, Gong, WebSearch/WebFetch, or Playwright, and do NOT touch `data/accounts/*.json` or `data/index.json`. Target duration: under 2 minutes.

Output: `data/activity/{slug}.json` — a sidecar the dashboard's "Salesforce activity" box renders.

## Step 0 — Run log open

Append a run entry to `data/meta.json` `runs[]` (same shape as other runs): `{"id": "<job id>", "started": "<ISO>", "finished": null, "mode": "activity", "trigger": "<api|interactive>", "accounts_touched": [], "credits_consuming_calls": [], "errors": [], "notes": []}`. This run should NEVER have credit-consuming calls. Finalize the entry at the end. If Salesforce fails to authenticate, record it loudly in `errors[]` and still write the sidecar with an `error` field — never fail silently.

## Step 1 — Resolve the account

Find the account in `data/index.json` by domain/slug/name. If a dossier exists (`data/accounts/{slug}.json`), take `salesforce.account_id` from it. Otherwise resolve the SF Account Id with one SOQL against the universe (`WHERE BDR__c = '<config.salesforce.bdr_user_id>'`, match on Website/Name). No match → write the sidecar with an `error` explaining that, finalize the run entry, stop.

## Step 2 — Pull activity

Two SOQL queries against the resolved Account Id:

1. **Tasks** (calls, logged emails, to-dos): `SELECT Id, Subject, Description, TaskSubtype, Status, ActivityDate, CreatedDate, Owner.Name, Who.Name FROM Task WHERE AccountId = '<id>' ORDER BY CreatedDate DESC LIMIT 20`
2. **Events** (meetings): `SELECT Id, Subject, Description, ActivityDate, StartDateTime, CreatedDate, Owner.Name, Who.Name FROM Event WHERE AccountId = '<id>' ORDER BY CreatedDate DESC LIMIT 10`

Remember this org's gotchas:
- `ActivityDate` can be FUTURE-dated (scheduled sequence steps). An activity whose date is after today is `"scheduled": true` — it has not happened; never present it as the "last touch".
- Activity records are record touches, not proof of employment or engagement.
- Large result sets may be saved to a session tool-results file — process from there with jq rather than Reading it whole.

## Step 3 — Write the sidecar

Build and write `data/activity/{slug}.json` (create the dir if needed; write a temp file ending in `.json`, then move/cat-redirect into place):

```json
{
  "slug": "<slug>", "domain": "<domain>", "sf_account_id": "<id>",
  "retrieved_at": "<ISO now>",
  "last_call": {"subject": "", "snippet": "", "who": "<contact>", "owner": "<G2 user>", "at": "<ISO>"} ,
  "last_outreach": {"type": "email|task", "subject": "", "snippet": "", "who": "", "owner": "", "at": "<ISO>"},
  "last_meeting": {"subject": "", "snippet": "", "who": "", "owner": "", "at": "<ISO>"},
  "activities": [
    {"type": "call|email|task|event", "subject": "", "snippet": "", "who": "", "owner": "", "at": "<ISO>", "scheduled": false}
  ],
  "error": null
}
```

- `last_call` / `last_outreach` / `last_meeting`: the most recent NON-scheduled item of each kind, `null` if none exists. Classify with `TaskSubtype` (Call/Email/Task) and Event for meetings.
- `snippet`: first ~300 characters of `Description` (call notes / email body), whitespace-collapsed, `""` if empty. This is "what they said" — keep it verbatim, just truncated.
- `activities`: up to 15 most recent items (Tasks + Events merged, newest first by CreatedDate), scheduled items included but flagged.
- `at`: prefer `ActivityDate`/`StartDateTime` when past-dated, else `CreatedDate`.

## Step 4 — Finalize

Update the run entry: `finished`, `accounts_touched: ["<slug>"]`, a one-line note (counts: N tasks / M events, last real touch date). Done.
