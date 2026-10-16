// One-time (and re-login) helper for the Groove CLI profile.
//
// Separate dedicated profile from LinkedIn's — never share the two. Same
// mock-keychain rule applies: this profile must ONLY ever be opened through
// Playwright. Playwright launches Chrome with --use-mock-keychain, so cookies
// written by a normally-launched Chrome (real Keychain) are unreadable here —
// and vice versa, a plain Chrome launch on this profile DESTROYS the
// Playwright-written session cookies (lesson learned the hard way on the
// LinkedIn profile 2026-07-15 — see CLAUDE.md).
//
// Usage: cd server && npm run groove:login
// Log into Groove in the window that opens, then close the browser window
// yourself. No credentials are ever stored.
import { chromium } from 'playwright-core'
import { config } from '../lib/config.js'

const profileDir = config.groove.profile_dir

const ctx = await chromium.launchPersistentContext(profileDir, {
  channel: 'chrome',
  headless: false,
  viewport: null,
})
const page = ctx.pages()[0] ?? (await ctx.newPage())
await page.goto(config.groove.base_url)
console.log(`Log into Groove in the window that just opened.`)
console.log(`Profile: ${profileDir}`)
console.log(`When done, QUIT that Chrome fully (Cmd+Q) — on macOS closing the window alone leaves the process holding the profile lock.`)
await new Promise((resolve) => ctx.on('close', resolve))
console.log('Browser closed. Run `npm run groove:check` to confirm the session took.')
