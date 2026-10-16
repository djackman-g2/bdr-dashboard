// Confirms the dedicated Groove profile holds a live session under the SAME
// launch conditions the Groove CLI uses (Playwright defaults, incl.
// --use-mock-keychain). Exit 0 = logged in, 1 = authwall/login redirect,
// 2 = error.
//
// The login-redirect pattern below is a best guess (Groove commonly redirects
// to a /users/sign_in or /login path) — if this ever misreports, watch the
// URL/TITLE it prints and tighten the regex.
//
// Usage: cd server && npm run groove:check
import { chromium } from 'playwright-core'
import { config } from '../lib/config.js'

try {
  const ctx = await chromium.launchPersistentContext(config.groove.profile_dir, {
    channel: 'chrome',
    headless: false,
    viewport: null,
  })
  const page = ctx.pages()[0] ?? (await ctx.newPage())
  await page.goto(config.groove.base_url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await page.waitForTimeout(6000)
  const url = page.url()
  console.log('URL:  ', url)
  console.log('TITLE:', await page.title())
  // URL alone is NOT enough: Groove serves its login page from the host root
  // with no path marker, so the URL regex reported LOGGED IN against a live
  // sign-in page (2026-08-18 — the pull then failed 401). Title and a real
  // authenticated API call are the honest signals; the API call is decisive
  // because it is exactly what the CLI does.
  const title = await page.title()
  const probe = await page
    .evaluate(async (base) => {
      const r = await fetch(`${base}/api/v2/user`, { credentials: 'include', headers: { Accept: 'application/json' } })
      return r.status
    }, (config.groove.api_base_url ?? config.groove.base_url).replace(/\/+$/, ''))
    .catch(() => null)
  const walled = /sign_?in|\/login|\/auth|checkpoint/i.test(url) || /sign[- ]?in|log[- ]?in/i.test(title) || probe !== 200
  console.log('PROBE: GET /api/v2/user →', probe ?? 'failed')
  console.log(walled
    ? 'RESULT: AUTHWALL — no session. Run `npm run groove:login` and log in by hand.'
    : 'RESULT: LOGGED IN — profile is ready for the Groove CLI.')
  await ctx.close()
  process.exit(walled ? 1 : 0)
} catch (err) {
  console.error('ERROR:', err.message)
  process.exit(2)
}
