// One-time (and re-login) helper for the Phase 5 LinkedIn verification profile.
//
// The dedicated Chrome profile must ONLY ever be opened through Playwright:
// Playwright launches Chrome with --use-mock-keychain, so cookies written by a
// normally-launched Chrome (real Keychain) are unreadable here — and vice
// versa, a plain Chrome launch on this profile DESTROYS the Playwright-written
// session cookies. Discovered the hard way 2026-07-15.
//
// Usage: cd server && npm run linkedin:login
// Log into LinkedIn (and open Sales Navigator once) in the window that opens,
// then close the browser window yourself. No credentials are ever stored.
import { chromium } from 'playwright-core'
import { config } from '../lib/config.js'

const profileDir = config.linkedin.profile_dir

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: null,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto('https://www.linkedin.com/login')
console.log(`Log into LinkedIn (and visit Sales Navigator once) in the window that just opened.`)
console.log(`Profile: ${profileDir}`)
console.log(`When done, QUIT that Chrome fully (Cmd+Q) — on macOS closing the window alone leaves the process holding the profile lock.`)
await new Promise((resolve) => ctx.on('close', resolve))
console.log('Browser closed. Run `npm run linkedin:check` to confirm the session took.')
