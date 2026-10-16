// Groove CLI — full read/write parity with the Groove web UI, via the
// reverse-engineered internal API in server/lib/groove.js. Human-invoked
// terminal tool only; never wired into the headless pipeline.
//
// Usage:
//   npm run groove -- flows list
//   npm run groove -- flows show <flowId>
//   npm run groove -- flows due [--flow <flowId>]
//   npm run groove -- contact show <contactId|email>
//   npm run groove -- contact log-call <contactId> --disposition "<text>" [--note "<text>"] [--dry-run]
//   npm run groove -- contact log-email <contactId> --subject "<text>" --body "<text>" [--dry-run]
//   npm run groove -- contact advance-step <contactId> [--dry-run]
//   npm run groove -- flow enroll <contactId> <flowId> [--dry-run]
//   npm run groove -- flow remove <contactId> <flowId> [--dry-run]
//   npm run groove -- bulk enroll --flow <flowId> --contacts <id1,id2,...> [--dry-run]
//   npm run groove -- bulk remove --flow <flowId> --contacts <id1,id2,...> [--dry-run]
//   npm run groove -- session check
import * as groove from '../lib/groove.js'

const args = process.argv.slice(2)
const [noun, verb, ...rest] = args
const flag = (name) => rest.includes(`--${name}`)
const opt = (name) => {
  const i = rest.indexOf(`--${name}`)
  return i >= 0 ? rest[i + 1] : null
}
const positional = rest.filter((a, i) => !a.startsWith('--') && (i === 0 || !rest[i - 1]?.startsWith('--')))
const DRY = flag('dry-run')

function usageAndExit() {
  console.error(`usage:
  npm run groove -- flows list
  npm run groove -- flows show <flowId>
  npm run groove -- flows due [--flow <flowId>]
  npm run groove -- contact show <contactId|email>
  npm run groove -- contact log-call <contactId> --disposition "<text>" [--note "<text>"] [--dry-run]
  npm run groove -- contact log-email <contactId> --subject "<text>" --body "<text>" [--dry-run]
  npm run groove -- contact advance-step <contactId> [--dry-run]
  npm run groove -- flow enroll <contactId> <flowId> [--dry-run]
  npm run groove -- flow remove <contactId> <flowId> [--dry-run]
  npm run groove -- bulk enroll --flow <flowId> --contacts <id1,id2,...> [--dry-run]
  npm run groove -- bulk remove --flow <flowId> --contacts <id1,id2,...> [--dry-run]
  npm run groove -- session check`)
  process.exit(1)
}

async function main() {
  if (!noun || !verb) usageAndExit()
  const opts = { dryRun: DRY }

  if (noun === 'flows') {
    if (verb === 'list') return console.log(JSON.stringify(await groove.listFlows(), null, 2))
    if (verb === 'show') return console.log(JSON.stringify(await groove.getFlow(positional[0]), null, 2))
    if (verb === 'due') return console.log(JSON.stringify(await groove.getDueContacts({ flowId: opt('flow') }), null, 2))
    usageAndExit()
  }

  if (noun === 'contact') {
    const id = positional[0]
    if (!id) usageAndExit()
    if (verb === 'show') return console.log(JSON.stringify(await groove.getContact(id), null, 2))
    if (verb === 'log-call') {
      const disposition = opt('disposition')
      if (!disposition) { console.error('--disposition is required'); process.exit(1) }
      return console.log(JSON.stringify(await groove.logCall(id, { disposition, note: opt('note') }, opts), null, 2))
    }
    if (verb === 'log-email') {
      const subject = opt('subject'), body = opt('body')
      if (!subject || !body) { console.error('--subject and --body are required'); process.exit(1) }
      return console.log(JSON.stringify(await groove.logEmail(id, { subject, body }, opts), null, 2))
    }
    if (verb === 'advance-step') return console.log(JSON.stringify(await groove.advanceStep(id, opts), null, 2))
    usageAndExit()
  }

  if (noun === 'flow') {
    const [contactId, flowId] = positional
    if (!contactId || !flowId) usageAndExit()
    if (verb === 'enroll') return console.log(JSON.stringify(await groove.enrollContact(contactId, flowId, opts), null, 2))
    if (verb === 'remove') return console.log(JSON.stringify(await groove.removeContact(contactId, flowId, opts), null, 2))
    usageAndExit()
  }

  if (noun === 'bulk') {
    const flowId = opt('flow')
    const contactIds = opt('contacts')?.split(',').map((s) => s.trim()).filter(Boolean)
    if (!flowId || !contactIds?.length) { console.error('--flow and --contacts are required'); process.exit(1) }
    if (verb === 'enroll') return console.log(JSON.stringify(await groove.bulkEnroll(flowId, contactIds, opts), null, 2))
    if (verb === 'remove') return console.log(JSON.stringify(await groove.bulkRemove(flowId, contactIds, opts), null, 2))
    usageAndExit()
  }

  if (noun === 'session' && verb === 'check') {
    // Delegate to the standalone checker script for a consistent exit-code contract.
    const { execFileSync } = await import('node:child_process')
    execFileSync(process.execPath, [new URL('./groove-session-check.js', import.meta.url).pathname], { stdio: 'inherit' })
    return
  }

  usageAndExit()
}

try {
  await main()
} catch (e) {
  console.error(`ERROR: ${e.message}`)
  process.exit(1)
}
