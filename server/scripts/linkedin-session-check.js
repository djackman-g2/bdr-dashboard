// Confirms the dedicated profile holds a live LinkedIn session under the SAME
// launch conditions the Playwright MCP uses (Playwright defaults, incl.
// --use-mock-keychain). Exit 0 = logged in, 1 = authwall, 2 = error.
// Usage: cd server && npm run linkedin:check
import { chromium } from 'playwright-core'
import { config } from '../lib/config.js'

try {
  const ctx = await chromium.launchPersistentContext(config.linkedin.profile_dir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto('https://www.linkedin.com/feed/', { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(6000)
  const url = page.url()
  console.log('URL:  ', url)
  console.log('TITLE:', await page.title())
  const walled = /authwall|\/login|\/signup|checkpoint|uas\/login/.test(url)
  console.log(walled
    ? 'RESULT: AUTHWALL — no session. Run `npm run linkedin:login` and log in by hand.'
    : 'RESULT: LOGGED IN — profile is ready for deep-run verification.')
  await ctx.close()
  process.exit(walled ? 1 : 0)
} catch (err) {
  console.error('ERROR:', err.message)
  process.exit(2)
}
