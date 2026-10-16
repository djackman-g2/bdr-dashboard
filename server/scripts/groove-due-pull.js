// Pull today's Groove due list straight from Groove's own API, WITH the step
// each person is actually on.
//
//   cd server && npm run due:pull                 # today, every flow with due work
//   cd server && npm run due:pull -- --flow 1483166
//   cd server && npm run due:pull -- --type TEMPLATE   # email steps only
//
// Why this exists: the Groove UI export drops Current Step (and a UI paste
// drops SFDC IDs too), so every drafted message had to guess the channel and
// step — and the standing rule is that a Groove step is never inferred. The
// due-list endpoint the Groove web app calls for its own due tab returns
// step_id per person; joining that against the flow's step list gives the
// real step name, day number and type. Nothing here is inferred.
//
// Output, both written to data/groove/:
//   due-<date>.json — full fidelity: step_id, step_type, day_number, template
//                     subject/body, flow name, per-person Groove + SFDC ids
//   due-<date>.csv  — exactly the columns the Groove export SHOULD produce
//                     (Name,Email,SFDC ID,Account,Current Step,Managed By,
//                     Added By), so `npm run draft:due -- <that csv>` works
//                     unchanged and finally sees true steps.
//
// Read-only: three GETs per flow, no writes, nothing counted against the
// Groove write rate limits. Human-invoked only, like the rest of the CLI.
import fs from 'node:fs/promises'
import path from 'node:path'
import { paths } from '../lib/config.js'
import * as groove from '../lib/groove.js'

const args = process.argv.slice(2)
const opt = (name) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : null
}
const ONLY_FLOW = opt('flow')
// --type takes one or more step types: --type TEMPLATE, --type CALL,OTHER
const ONLY_TYPE = opt('type')
  ? opt('type').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
  : null
const FILTER = opt('filter') ?? 'due_today'

const csvCell = (v) => {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

async function main() {
  const flowsResp = await groove.listFlows()
  const flows = flowsResp?.data
  if (!Array.isArray(flows)) {
    throw new Error('flows-list returned no "data" array — Groove\'s API shape changed; re-run `npm run groove:capture`.')
  }

  let targets = flows.filter((f) => (f.due_people_count ?? 0) > 0)
  if (ONLY_FLOW) targets = flows.filter((f) => String(f.id) === String(ONLY_FLOW))
  if (!targets.length) {
    console.log(ONLY_FLOW ? `flow ${ONLY_FLOW} not found or has nothing due.` : 'nothing due in any flow.')
    return
  }

  console.log(`${targets.length} flow(s) with work due:`)
  for (const f of targets) console.log(`  ${f.id} — ${f.name} (${f.due_people_count} due)`)

  const rows = []
  for (const flow of targets) {
    // Steps first: the join table that turns step_id into a real step.
    const stepsResp = await groove.getSteps(flow.id, { withTemplates: true })
    const steps = stepsResp?.data
    if (!Array.isArray(steps)) {
      throw new Error(`steps-list for flow ${flow.id} returned no "data" array — re-run \`npm run groove:capture\`.`)
    }
    const stepById = new Map(steps.map((s) => [s.id, s]))

    const { rows: people, total } = await groove.getAllDueContacts({ flowId: flow.id, filter: FILTER })
    console.log(`\n${flow.name}: ${people.length}/${total} people pulled`)

    for (const p of people) {
      const step = stepById.get(p.step_id)
      if (!step) {
        // Loud, not skipped: an unmapped step is exactly the "what step are
        // they on" hole this script exists to close.
        throw new Error(
          `person ${p.name} (${p.id}) is on step_id ${p.step_id}, which is not in flow ${flow.id}'s step list — re-run \`npm run groove:capture\` and re-curate the map.`
        )
      }
      rows.push({
        groove_person_id: p.id,
        person_step_id: p.person_step_id,
        sfdc_id: p.sfdc_id ?? null,
        name: p.name,
        email: p.email ?? null,
        title: p.title ?? null,
        account: p.company ?? null,
        groove_account_id: p.account_id ?? null,
        flow_id: flow.id,
        flow_name: flow.name,
        step_id: step.id,
        step: step.name_with_day_count ?? step.name,
        step_name: step.name,
        step_type: step.step_type,
        step_subtype: step.step_subtype ?? null,
        day_number: step.day_number ?? null,
        template_subject: step.subject_line ?? step.subject ?? null,
        template_body: step.text_body ?? null,
        owner: p.person_step_owner_name ?? null,
        added_by: p.imported_by_user_name ?? null,
      })
    }
  }

  const byType = rows.reduce((acc, r) => ((acc[r.step_type] = (acc[r.step_type] ?? 0) + 1), acc), {})
  console.log(`\n${rows.length} due total — ` + Object.entries(byType).map(([t, n]) => `${t}: ${n}`).join(', '))

  const filtered = ONLY_TYPE ? rows.filter((r) => ONLY_TYPE.includes(r.step_type)) : rows
  if (ONLY_TYPE) console.log(`--type ${ONLY_TYPE.join(',')}: ${filtered.length} of ${rows.length} rows written`)

  const missingSf = filtered.filter((r) => !r.sfdc_id).length
  if (missingSf) console.log(`note: ${missingSf} row(s) have no SFDC ID — draft:due falls back to email, then name+account.`)

  const date = new Date().toLocaleDateString('en-CA')
  const outDir = path.join(paths.dataDir, 'groove')
  await fs.mkdir(outDir, { recursive: true })

  // A --type run writes its own file — otherwise the filtered pull silently
  // overwrites the full one and the rest of the day's work disappears.
  const stem = `due-${date}${ONLY_FLOW ? `-flow${ONLY_FLOW}` : ''}${ONLY_TYPE ? `-${ONLY_TYPE.join('-').toLowerCase()}` : ''}`
  const jsonFile = path.join(outDir, `${stem}.json`)
  const tmp = jsonFile.replace(/\.json$/, '.tmp.json') // never *.json.tmp — ajv treats non-.json temps as JS
  await fs.writeFile(
    tmp,
    JSON.stringify({ date, filter: FILTER, pulled_at: new Date().toISOString(), counts: byType, rows: filtered }, null, 2) + '\n'
  )
  await fs.rename(tmp, jsonFile)

  // Same header/order as the real Groove export so draft-due-csv.js consumes
  // it with no changes — this is the export as it should have been, PLUS a
  // Title column the real export also lacks.
  //
  // Title matters more than it looks (2026-09-08). draft-due-csv.js resolved a
  // new contact's title from the Salesforce-derived mirror, but a person
  // enrolled in Groove today has no mirror row for weeks — the SF sync that
  // builds it runs long before the enrollment lands (the
  // dossier-predates-enrollment-contacts rule). So every freshly enrolled
  // contact was created with title:null → persona:null → drafts written with
  // no persona routing at all, which is most of a hyper-personalised message.
  // Groove's own due-list rows carry the title on ~100% of people; it was
  // being thrown away here at the CSV boundary.
  const header = ['Name', 'Email', 'SFDC ID', 'Account', 'Current Step', 'Managed By', 'Added By', 'Title']
  const csv = [
    header.join(','),
    ...filtered.map((r) =>
      [r.name, r.email, r.sfdc_id, r.account, r.step, r.owner, r.added_by, r.title].map(csvCell).join(',')
    ),
  ].join('\n')
  const csvFile = path.join(outDir, `${stem}.csv`)
  await fs.writeFile(csvFile, csv + '\n')

  console.log(`\n  ${jsonFile}`)
  console.log(`  ${csvFile}`)
  console.log(`\nnext: cd server && npm run draft:due -- "${csvFile}" --dry-run`)
}

main().catch((e) => {
  console.error(`\n${e.message}`)
  process.exit(1)
})
