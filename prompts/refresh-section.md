# Refresh ONE section of an account dossier (fast, free)

You are the research engine for the BDR Account Research Dashboard, running a **single-section** refresh. The run parameters block below names the account and the `Target section`. Read `CLAUDE.md` first — all data-integrity rules apply. This run is deliberately small and FREE:

- **No paid calls, ever.** No ZoomInfo tools at all. Sections that need enrichment credits (contacts, firmographics) are deep-refresh-only by design.
- **No Playwright** (it is hard-blocked). If a page needs a rendered browser (bot-blocked careers board, JS-heavy article) record it in `sources_missing` `kind: "attempted_failed"` and move on — a full deep refresh has the fallback.
- Touch ONLY the target section (plus `signals[]`/`sources_missing`/`discrepancies` when the section's own rules add entries there). Everything else in the dossier stays byte-identical.

Target duration: 2–8 minutes depending on section.

## Step 0 — Run log open

Append a run entry to `data/meta.json` `runs[]` (standard shape, `"mode": "section"`, note the section). `credits_consuming_calls` MUST stay empty. Finalize at the end; failures loud in `errors[]`, never silent.

## Step 1 — Load the dossier

The account must already have `data/accounts/{slug}.json` (resolve slug via `data/index.json`). If it doesn't, write the run entry with an error ("no dossier — run a deep refresh first") and stop. Read the dossier; you will surgically replace one section of it.

## Step 2 — Refresh the target section

Follow the SAME rules as the corresponding step in `prompts/refresh-account.md`:

- **news** — WebSearch within `config.news.lookback_days` → WebFetch each source page to confirm date/publisher/claim on-page (`date_confirmed_on_page`). Fetch confirmation pages in parallel where possible. Replace `news[]`; append NEW material events to `signals[]` (keep existing signal entries — never rewrite history).
- **hiring** — careers page via WebFetch (or a public ATS API when the board exposes one — e.g. Greenhouse/Workable JSON): open roles total, role mix, direction, as-of timestamp. Replace `hiring`.
- **g2** — G2 MCP Server tools (`show_product`/`show_vendor`; attempt intent tools, expect the known tenant-scoped-suspect result — quarantine per CLAUDE.md). Replace `g2` (fresh ratings/review counts + `presence_summary`).
- **gong** — `ask_account` (workspace "Initial workspace"). Replace `gong`.
- **messaging** — regenerate from the CURRENT dossier's verified facts only (no new research): 2-4 angles with `grounded_in`, 2-3 openers, `things_to_probe`, fresh `generated_at`. Replace `messaging`.

## Step 3 — Write + validate

1. Apply the section replacement to the dossier in a temp copy ending in `.json`.
2. Validate: `npx --yes -p ajv-cli@5 -p ajv-formats ajv validate -c ajv-formats --spec=draft7 -s schema/account.schema.json -d <temp file>`. Fix violations before writing.
3. Atomically replace `data/accounts/{slug}.json` (rename or cat-redirect). Do NOT change the dossier's `refreshed_at`/`last_deep_refresh_at` — a section refresh is not a full refresh; the section's own timestamp fields (`generated_at`, `as_of`, `retrieved_at`) carry the freshness.
4. If the section produced a materially better `top_signal`, update the account's row in `data/index.json` (keep `status` as-is).
5. Finalize the run entry: `finished`, `accounts_touched: ["<slug>"]`, one-line note on what changed.
