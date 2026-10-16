#!/usr/bin/env node
// Regenerate data/dust-account-list.txt — the account book as a flat file for the Dust
// "Intent Watch" agent's datasource (see docs/dust-intent-agent.md).
//
// Excludes:
//   - archived accounts (left the BDR universe)
//   - any account with a non-empty `open_opps` — an open opportunity is the AE's live deal,
//     so it is not a prospecting target and news about it is noise (CLAUDE.md rule 13)
//
// Deliberately INCLUDES accounts whose `open_opps` is absent: absent means "never checked",
// not "clear", and silently dropping ~480 unchecked accounts would gut the list.
//
// Output stays under data/ because it is CRM-derived and gitignored there. Never write an
// account list into a tracked directory.
//
// Usage: cd server && npm run dust:list [-- --dry-run]

import { readFile, writeFile, rename } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const dataDir = path.resolve(here, '../../data')
const outPath = path.join(dataDir, 'dust-account-list.txt')

const dry = process.argv.includes('--dry-run')

const index = JSON.parse(await readFile(path.join(dataDir, 'index.json'), 'utf8'))
if (!Array.isArray(index.accounts)) throw new Error('index.json: expected { accounts: [...] }')

const archived = index.accounts.filter((a) => a.status === 'archived')
const live = index.accounts.filter((a) => a.status !== 'archived')
const withOpp = live.filter((a) => Array.isArray(a.open_opps) && a.open_opps.length > 0)
const keep = live
  .filter((a) => !(Array.isArray(a.open_opps) && a.open_opps.length > 0))
  .filter((a) => a.domain)
  .sort((x, y) => (x.name || x.domain).toLowerCase().localeCompare((y.name || y.domain).toLowerCase()))

const lines = [
  '# Declan Jackman — FY27 prospecting book (for the Dust "Intent Watch" datasource)',
  `# ${keep.length} accounts. Generated from data/index.json (${index.generated_at ?? 'no generated_at'}).`,
  '# Excludes archived accounts and any account with an open Salesforce opportunity',
  "# (an open opp is the AE's live deal — not a prospecting target).",
  '# Format: Company Name | domain | industry',
  '',
  ...keep.map((a) => `${a.name || a.domain} | ${a.domain} | ${a.industry || '-'}`),
]

console.log(`archived (excluded):   ${archived.length}`)
console.log(`open opp (excluded):   ${withOpp.length}`)
console.log(`no domain (excluded):  ${live.length - withOpp.length - keep.length}`)
console.log(`written:               ${keep.length}`)

if (dry) {
  console.log('\n--dry-run: nothing written')
} else {
  // *.tmp.json is the convention for JSON temps; plain .tmp is fine for text.
  const tmp = `${outPath}.tmp`
  await writeFile(tmp, lines.join('\n') + '\n', 'utf8')
  await rename(tmp, outPath)
  console.log(`\nwrote ${path.relative(path.resolve(here, '../..'), outPath)}`)
}
