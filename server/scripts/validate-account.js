#!/usr/bin/env node
// Validate a dossier JSON against schema/account.schema.json.
//
// Exists because the `npx --yes -p ajv-cli@5 ... ajv validate` invocation the
// prompts used to carry ALWAYS dies behind G2's registry with
// SELF_SIGNED_CERT_IN_CHAIN. ajv is already a server dependency, so validate
// in-process and skip the network entirely.
//
//   node server/scripts/validate-account.js <file.json> [more.json ...]
//
// Exit 0 = every file valid. Exit 1 = at least one invalid (errors printed).
// Exit 2 = usage/read error.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const files = process.argv.slice(2)
if (!files.length) {
  console.error('usage: node server/scripts/validate-account.js <file.json> [...]')
  process.exit(2)
}

let schema
try {
  schema = JSON.parse(await fs.readFile(path.join(root, 'schema/account.schema.json'), 'utf8'))
} catch (err) {
  console.error(`cannot read schema: ${err.message}`)
  process.exit(2)
}

// strict:false matches how aiVisibility.js/community.js compile it — the
// schema uses a few keywords ajv's strict mode rejects outright.
const ajv = new Ajv({ strict: false, allErrors: true })
addFormats(ajv)
const validate = ajv.compile(schema)

let bad = 0
for (const f of files) {
  let data
  try {
    data = JSON.parse(await fs.readFile(f, 'utf8'))
  } catch (err) {
    console.error(`✗ ${f}: unreadable/unparseable — ${err.message}`)
    bad++
    continue
  }
  if (validate(data)) {
    console.log(`✓ ${f}`)
  } else {
    bad++
    console.error(`✗ ${f}: ${validate.errors.length} schema error(s)`)
    for (const e of validate.errors) {
      console.error(`    ${e.instancePath || '/'} ${e.message}${e.params ? ' ' + JSON.stringify(e.params) : ''}`)
    }
  }
}
process.exit(bad ? 1 : 0)
