// Groove API discovery — passive network capture.
//
// Groove has no public API. Before server/lib/groove.js can call anything,
// we need to know what Groove's OWN web app actually calls under the hood.
// This script opens the dedicated Groove profile, watches (never intercepts
// or mutates) network traffic, and records it while a human manually
// performs each target action in the browser window. The output is a RAW
// capture — noisy on purpose (telemetry, prefetches, polling included) — that
// a human then hand-curates into data/groove/endpoint-map.json. Nothing in
// server/lib/groove.js is ever coded against a guessed endpoint; it is coded
// only against the curated map.
//
// Usage: cd server && npm run groove:capture
// A prompt asks for a short label before each action (e.g. "log-call"); type
// it, hit enter, then perform that one action in the browser window. Traffic
// captured between labels is bracketed under the label that preceded it.
// Ctrl+C or close the browser window to stop; the raw capture is flushed
// continuously so nothing already captured is lost.
//
// Suggested actions to exercise, one at a time: flows-list, flow-show,
// due-list, contact-show, log-call, log-email, advance-step, enroll,
// remove, bulk-action.
import { chromium } from 'playwright-core'
import readline from 'node:readline'
import fs from 'node:fs/promises'
import path from 'node:path'
import { config, paths } from '../lib/config.js'

const profileDir = config.groove.profile_dir
const outDir = path.join(paths.dataDir, 'groove')
const outFile = path.join(outDir, 'endpoint-map-raw.json')
await fs.mkdir(outDir, { recursive: true })

const captured = []
let currentLabel = '(unlabeled)'
let flushing = Promise.resolve()

function flush() {
  flushing = flushing.then(async () => {
    const tmp = `${outFile}.tmp.json`
    await fs.writeFile(tmp, JSON.stringify({ captured_at: new Date().toISOString(), requests: captured }, null, 2) + '\n')
    await fs.rename(tmp, outFile)
  })
  return flushing
}

// Redact secrets by presence, not value — we want to know a header/cookie was
// sent, never what it contained.
function redactHeaders(headers) {
  const out = {}
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = /cookie|auth|token/i.test(k) ? `<present, ${String(v).length} chars>` : v
  }
  return out
}

function safeJson(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    return text.length > 2000 ? text.slice(0, 2000) + '…(truncated)' : text
  }
}

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: null,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())

let host = null
try {
  host = new URL(config.groove.base_url).host
} catch {
  /* base_url misconfigured — capture everything, filter later by hand */
}

page.on('requestfinished', async (request) => {
  try {
    const url = request.url()
    if (host && !new URL(url).host.includes(host)) return
    if (/\.(png|jpg|jpeg|gif|svg|css|woff2?|ttf|ico)(\?|$)/i.test(url)) return
    const response = await request.response()
    const entry = {
      label: currentLabel,
      ts: new Date().toISOString(),
      method: request.method(),
      url,
      requestHeaders: redactHeaders(await request.allHeaders()),
      requestBody: safeJson(request.postData()),
      status: response?.status() ?? null,
      responseBody: response ? safeJson(await response.text().catch(() => null)) : null,
    }
    captured.push(entry)
    console.log(`[${currentLabel}] ${entry.method} ${entry.status ?? '?'} ${url}`)
    flush()
  } catch {
    /* a request we raced with navigation/close — skip it, never crash the capture */
  }
})

await page.goto(config.groove.base_url)
console.log(`Dedicated Groove profile open: ${profileDir}`)
console.log('Type a short label for the next action (e.g. log-call), press enter, then perform')
console.log('that ONE action in the browser window. Suggested sequence: flows-list, flow-show,')
console.log('due-list, contact-show, log-call, log-email, advance-step, enroll, remove, bulk-action.')
console.log('Ctrl+C or close the browser window when done — capture is saved continuously to:')
console.log(`  ${outFile}`)

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
const promptLoop = async () => {
  for (;;) {
    currentLabel = (await new Promise((resolve) => rl.question('label> ', resolve))).trim() || currentLabel
  }
}
promptLoop()

await new Promise((resolve) => ctx.on('close', resolve))
rl.close()
await flush()
console.log(`\nDone. ${captured.length} requests captured across ${new Set(captured.map((c) => c.label)).size} labels.`)
console.log(`Hand-curate ${outFile} into ${path.join(outDir, 'endpoint-map.json')} before writing any client code against it.`)
