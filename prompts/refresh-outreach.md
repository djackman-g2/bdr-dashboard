# Outreach sync — mirror Groove's activity trail from Salesforce (fast, free)

You are the research engine for the BDR Account Research Dashboard, running an **outreach sync**. Groove has no API, but it is Salesforce-native: every email, LinkedIn touch, and call it sends/logs becomes a Task record owned by the BDR. This run reads that trail and writes one global mirror file the dashboard's tracker consumes. Read `CLAUDE.md` first — all data-integrity rules apply.

This run is deliberately small: **Salesforce reads only**. Do NOT call ZoomInfo, G2, Gong, WebSearch/WebFetch, or Playwright, and do NOT touch `data/accounts/*.json`, `data/index.json`, or `data/tracker.json`. Target duration: under 5 minutes.

Output: `data/outreach.json`.

## Step 0 — Run log open

Append a run entry to `data/meta.json` `runs[]`: `{"id": "<job id>", "started": "<ISO>", "finished": null, "mode": "outreach", "trigger": "<from run parameters>", "accounts_touched": [], "credits_consuming_calls": [], "errors": [], "notes": []}`. This run must NEVER have credit-consuming calls. Finalize the entry at the end. If Salesforce fails to authenticate, record it loudly in `errors[]` AND write `data/outreach.json` with an `error` field — never fail silently.

## Step 1 — Pull the task trail

One SOQL query (owner id and window from `config/config.json` → `salesforce.bdr_user_id`, `outreach.window_days`):

```
SELECT Id, Subject, TaskSubtype, Type, Status, ActivityDate, CreatedDate,
       CallDisposition, WhoId, Who.Name, AccountId, Account.Name
FROM Task
WHERE OwnerId = '<bdr_user_id>' AND CreatedDate = LAST_N_DAYS:<window_days>
ORDER BY CreatedDate DESC LIMIT 2000
```

Deliberately NO `Description` — subjects and metadata are enough for the mirror; message bodies stay in SF and are pulled per-account only when the drafting engine needs them. Large result sets get saved to a session tool-results file — process from there with jq, never Read the whole thing.

Then fetch titles for the touched contacts (the tracker's persona matching needs them; Task rows don't carry titles): collect the distinct `WhoId`s that start with `003` (Contact records) and run `SELECT Id, Title FROM Contact WHERE Id IN (...)` in chunks of ≤ 400 ids. Missing/null titles are fine — record null.

## Step 2 — Classify each task

Groove/SalesNav subject conventions (verified in this org 2026-07-26):

- `Email: >> …` → channel `email`, direction `out`. `Email: << …` → `email`, `in` (an inbound message logged against the contact).
- `LinkedIn InMail: >> [Flow] - <flow name> - Day <N>` → `linkedin`, `out`, with flow name and day parsed from the subject. `Type = 'LinkedIn'` also marks LinkedIn touches.
- `Call: >> [Flow][<disposition>] - <label>` and any `TaskSubtype = 'Call'` → channel `call`, direction `out`, disposition from `CallDisposition` (may be null on quick "Call Log" entries).
- `InMail sent from Sales Navigator - <subject>` → `linkedin`, `out`. `Connection Request sent from Sales Navigator` → `linkedin`, `out`.
- `[Flow]` marker anywhere → the touch was a flow step; when the subject carries `<flow name> - Day <N>`, capture both. Flow emails have per-contact generated subjects (`Email: >> [Flow] - <whatever>`), so a missing flow name/day is normal — record what's there.
- Anything else → channel `other`, direction `out` unless a `<<` marker says otherwise.

Org gotchas that apply here:
- `ActivityDate` in the FUTURE (or Status not Completed with a future date) = a **scheduled** flow step that has NOT happened. Never count it as a touch — but DO capture it under `upcoming` (that's tomorrow's due list).
- Inbound emails (`<<`) include vendor/system mail auto-associated to contacts (e.g. benefits notifications). A contact counts as `replied` only if an inbound email arrives AFTER at least one outbound touch to that same contact.
- Tasks with no `WhoId` (account-level logs) go in the daily totals but not under any contact.

Connect classification (`config/config.json` → `outreach.connect_dispositions`): a call counts as a **connect** when its disposition starts with any listed prefix. `Left Voicemail` → vm. Store raw dispositions regardless.

## Step 3 — Write the mirror

Build and write `data/outreach.json` (temp file ending in `.json`, then move/cat-redirect into place):

```json
{
  "retrieved_at": "<ISO now>",
  "window_days": 30,
  "task_count": 0,
  "contacts": [
    {
      "sf_contact_id": "003…", "name": "<Who.Name>", "title": "<Contact.Title or null>",
      "sf_account_id": "001…", "account_name": "<Account.Name>",
      "last_outbound": "<ISO>", "last_inbound": "<ISO or null>", "replied": false,
      "flow": "<latest flow name seen or null>", "flow_day": null,
      "outbound_count": 0, "connects": 0,
      "touches": [
        {"at": "<ISO>", "channel": "email|linkedin|call|other", "direction": "out|in", "subject": "<raw subject>", "flow": null, "flow_day": null, "disposition": null}
      ],
      "upcoming": [
        {"at": "<ActivityDate>", "channel": "email|linkedin|call|other", "subject": "<raw subject>"}
      ]
    }
  ],
  "daily": [
    {"date": "YYYY-MM-DD", "calls": 0, "emails": 0, "linkedin": 0, "connects": 0, "vm": 0, "inbound": 0}
  ],
  "error": null
}
```

- `contacts`: one entry per distinct `WhoId`, sorted by `last_outbound` desc. `touches` newest-first, cap 20 per contact (completed/past items only). `flow`/`flow_day` from the most recent touch that carried them.
- `daily`: outbound totals per local calendar day across the whole window (plus `inbound` = replies received that day), newest first. This is ground truth the tracker's manual counts reconcile against.
- `at`: `CreatedDate` for completed touches; `ActivityDate` for `upcoming`.

## Step 4 — Finalize

Update the run entry: `finished`, a one-line note (N tasks → M contacts, X connects, Y replies in window, Z upcoming steps). `accounts_touched` stays `[]` — this run touches no dossiers. Done.
