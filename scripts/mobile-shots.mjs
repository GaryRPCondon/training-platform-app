/**
 * Mobile screenshot harness — drives the running app in a real headless Chromium
 * and captures every core page at a phone viewport (390×844). Use it to eyeball
 * responsive/layout changes against real data instead of guessing.
 *
 * It is a *visual* aid, not a test: it captures pixels, it does not assert. Run it
 * alongside `npm test`, not instead of it.
 *
 * ── Usage ──────────────────────────────────────────────────────────────────────
 *   1. Have a dev server running against this checkout, then:
 *        npm run mobile-shots
 *   Output PNGs land in docs/mobile_review/after/ (override with OUT_DIR=…).
 *   Point at a different origin with BASE_URL=… (default http://localhost:3000).
 *
 *   Always point BASE at a SAME-ORIGIN localhost server. Do NOT aim it at another
 *   machine's dev server over an IP (e.g. a Windows `npm run dev` via the WSL
 *   gateway) — cross-origin breaks Next's HMR/RSC handshake, the page never
 *   hydrates, and the demo button click is a silent no-op.
 *
 *   WSL + a Windows dev server on the same checkout: do NOT start a second
 *   `npm run dev` against the shared `.next` — they fight over the lockfile AND a
 *   half-started server can CORRUPT the Turbopack cache (mangled globals.css →
 *   500s) for the other one. Give the WSL server its own dist dir instead:
 *        NEXT_DIST_DIR=.next-mobshots npm run dev            # terminal 1 (WSL, localhost)
 *        npm run mobile-shots                                # terminal 2
 *   (next.config.ts reads NEXT_DIST_DIR; `.next-*` is gitignored.) Clean up the
 *   isolated dir when done: rm -rf .next-mobshots
 *
 * ── One-time host setup (Linux/WSL) ────────────────────────────────────────────
 *   Chromium needs a couple of system libs that aren't always present:
 *     sudo apt-get install -y libxdamage1 libxcomposite1
 *   The Chromium binary itself is downloaded automatically on first run into
 *   .cache/puppeteer/ (gitignored) and reused thereafter.
 *
 * ── Demo login ─────────────────────────────────────────────────────────────────
 *   Auth uses the app's public "Try the live demo" button (server-side creds via
 *   DEMO_EMAIL / DEMO_PASSWORD / DEMO_USER_ID in .env.local). Note this signs into
 *   the real remote demo account and may trigger the demo-login alert email. This
 *   script only navigates and screenshots — it never sends a chat message or does
 *   anything that would trigger a billable LLM call.
 */

import { install, resolveBuildId, detectBrowserPlatform, Browser } from '@puppeteer/browsers'
import puppeteer from 'puppeteer-core'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const BASE = process.env.BASE_URL || 'http://localhost:3000'
const OUT = path.resolve(ROOT, process.env.OUT_DIR || 'docs/mobile_review/after')
const CACHE = path.join(ROOT, '.cache', 'puppeteer')

// Pages to capture: [filename, route]. The login page is shot separately (pre-auth).
const PAGES = [
  ['02_dashboard', '/dashboard'],
  ['03_calendar', '/dashboard/calendar'],
  ['04_chat', '/dashboard/chat'],
  ['05_plans', '/dashboard/plans'],
  ['06_plans_new', '/dashboard/plans/new'],
  ['07_profile', '/dashboard/profile'],
]

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function ensureServer() {
  // Cross-origin dev servers (e.g. a Windows server hit via the WSL gateway IP)
  // break Next's HMR/hydration, so the demo button never becomes interactive.
  const host = new URL(BASE).hostname
  if (host !== 'localhost' && host !== '127.0.0.1') {
    console.warn(`\n⚠ BASE_URL host is "${host}", not localhost. Cross-origin dev servers break Next hydration —\n  the demo login click will likely no-op. Run a same-origin localhost server instead (see header).\n`)
  }
  try {
    const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) return
  } catch { /* fall through */ }
  console.error(`\n✗ Dev server not reachable at ${BASE}. Start it in this environment first:\n    npm run dev\n`)
  process.exit(1)
}

async function resolveChrome() {
  const platform = detectBrowserPlatform()
  const buildId = await resolveBuildId(Browser.CHROME, platform, 'stable')
  // install() is idempotent + cached; returns the exact executable path (don't
  // hand-build it — computeExecutablePath doubles the cache subdir).
  const installed = await install({ browser: Browser.CHROME, buildId, cacheDir: CACHE })
  return installed.executablePath
}

async function main() {
  await ensureServer()
  fs.mkdirSync(OUT, { recursive: true })
  const executablePath = await resolveChrome()

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
  })

  try {
    const page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true })

    // Login page (pre-auth), then click the public demo button.
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle2', timeout: 60000 })
    await sleep(1500) // let React hydrate so the button's onClick is actually attached
    await page.screenshot({ path: path.join(OUT, '01_login.png') })

    // Click the demo button and wait for the client-side redirect. On a cold dev
    // server hydration can lag, so retry the click if the first one is a no-op.
    let landed = false
    for (let attempt = 0; attempt < 3 && !landed; attempt++) {
      const clicked = await page.evaluate(() => {
        const btn = [...document.querySelectorAll('button')].find((b) => /try the live demo/i.test(b.textContent || ''))
        if (btn) { btn.click(); return true }
        return false
      })
      if (!clicked) throw new Error('"Try the live demo" button not found on /login — is the demo configured (DEMO_* env vars)?')
      try {
        await page.waitForFunction(() => location.pathname.startsWith('/dashboard'), { timeout: 15000 })
        landed = true
      } catch {
        await sleep(1500)
      }
    }
    if (!landed) throw new Error('Demo login did not navigate to /dashboard (login POST works — likely a hydration/redirect issue).')
    await sleep(2000)

    let ok = 0
    const overflows = []
    for (const [name, route] of PAGES) {
      try {
        await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60000 })
        // React-query pages hydrate data after load; wait so we don't shoot skeletons.
        await sleep(6000)
        // Horizontal-overflow check. IMPORTANT: fullPage screenshots capture the
        // whole scrollable canvas, so they HIDE horizontal overflow — a page that's
        // too wide looks fine in the PNG but is clipped in a real phone viewport.
        // Measure it explicitly so the harness flags what the screenshot can't show.
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
        if (overflow > 1) overflows.push(`${name} (+${overflow}px)`)
        await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
        console.log(overflow > 1 ? `⚠ ${name}  HORIZONTAL OVERFLOW +${overflow}px` : `✓ ${name}`)
        ok++
      } catch (e) {
        console.error('✗', name, '-', e.message)
      }
    }
    console.log(`\n${ok}/${PAGES.length} pages captured → ${OUT}`)
    if (overflows.length) {
      console.log(`\n⚠ HORIZONTAL OVERFLOW on ${overflows.length} page(s): ${overflows.join(', ')}`)
      console.log('  These render fine in the fullPage PNGs but are clipped on a real phone. Fix before shipping.')
    } else {
      console.log('✓ no horizontal overflow at this width')
    }
  } finally {
    await browser.close()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
