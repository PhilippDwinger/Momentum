/**
 * E2E for the real setup on Paddy's PC, simulated locally:
 *   http://localhost:4197/            -> Bridge          (like https://muttchen…:8443/)
 *   http://localhost:4197/momentum/   -> Momentum-Host   (like https://muttchen…:8443/momentum/, Tailscale path)
 * The browser app talks to Bridge DIRECTLY (same address), and the host updates the app from a
 * release feed (like GitHub Releases) – the open app then offers "Aktualisieren".
 *
 *   BRIDGE_TEST_URL=http://127.0.0.1:8002 node e2e/run-direct.mjs
 */
import { spawn, execFileSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium, devices } from 'playwright'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const BRIDGE = process.env.BRIDGE_TEST_URL
if (!BRIDGE) {
  console.log('run-direct: übersprungen (BRIDGE_TEST_URL fehlt)')
  process.exit(0)
}
const PORT = 4197
const FEED = 4196
const ORIGIN = `http://localhost:${PORT}`
const APP = `${ORIGIN}/momentum/`
const tmp = mkdtempSync(join(tmpdir(), 'momentum-direct-'))

// --- two app versions, built for "Bridge at this address" --------------------------------------
function build(n) {
  const out = join(tmp, `dist-${n}`)
  execFileSync(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], {
    cwd: root,
    env: { ...process.env, VITE_BRIDGE_URL: ORIGIN, VITE_APP_BUILD: String(n), VITE_APP_VERSION: `1.2.${n}` },
    stdio: 'inherit',
  })
  const pack = join(tmp, `pwa-${n}.json.gz`)
  execFileSync(process.execPath, [join(root, 'tools', 'pack-web.mjs'), out, pack, String(n), `1.2.${n}`], { stdio: 'ignore' })
  return pack
}
console.log('\nMomentum E2E – Browser direkt über Bridge + Auto-Update')
const packs = { 1: build(1), 2: build(2) }

// --- release feed (stands in for GitHub Releases) -----------------------------------------------
let feedBuild = 1
const feed = createServer((req, res) => {
  const m = req.url.match(/^\/pwa-(\d)\.json\.gz/)
  if (m && existsSync(packs[m[1]])) {
    res.writeHead(200, { 'content-type': 'application/gzip' })
    return res.end(readFileSync(packs[m[1]]))
  }
  if (req.url.startsWith('/latest.json')) {
    const buf = readFileSync(packs[feedBuild])
    res.writeHead(200, { 'content-type': 'application/json' })
    return res.end(JSON.stringify({ version: `1.2.${feedBuild}`, build: feedBuild, native: 1, minNative: 1, pwa: `http://127.0.0.1:${FEED}/pwa-${feedBuild}.json.gz`, pwaSha256: createHash('sha256').update(buf).digest('hex') }))
  }
  res.writeHead(404).end()
})
await new Promise((r) => feed.listen(FEED, '127.0.0.1', r))

// --- host: app under /momentum, everything else -> Bridge (like the Tailscale path mapping) ----
const host = spawn(process.execPath, [join(root, 'host', 'server.mjs')], {
  env: {
    ...process.env,
    MOMENTUM_PORT: String(PORT),
    BRIDGE_URL: BRIDGE,
    MOMENTUM_ROOT_PROXY: '1',
    MOMENTUM_UPDATE_URL: `http://127.0.0.1:${FEED}/latest.json`,
    MOMENTUM_UPDATE_SECONDS: '5',
    MOMENTUM_DIST: join(tmp, 'no-local-dist'),
    MOMENTUM_DATA: join(tmp, 'host-data'),
    MOMENTUM_TAILSCALE: 'off',
    MOMENTUM_PUSH_DRYRUN: '1',
  },
  stdio: ['ignore', 'pipe', 'inherit'],
})
let hostLog = ''
host.stdout.on('data', (d) => (hostLog += String(d)))
const info = () => fetch(`${APP}momentum-host/info`).then((r) => r.json())
async function waitFor(fn, ms, what) {
  const end = Date.now() + ms
  for (;;) {
    try {
      if (await fn()) return
    } catch {
      /* retry */
    }
    if (Date.now() > end) throw new Error(`timeout: ${what}`)
    await new Promise((r) => setTimeout(r, 300))
  }
}
await waitFor(async () => (await info()).web.build === 1, 30_000, 'host lädt Version 1')

const browser = await chromium.launch()
const results = []
async function test(name, fn) {
  try {
    await fn()
    results.push(true)
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push(false)
    console.log(`  ✗ ${name}\n      ${String(e.message).split('\n').slice(0, 8).join('\n      ')}`)
  }
}
async function newPage(opts = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin', ...opts })
  const page = await ctx.newPage()
  const requests = []
  page.on('request', (r) => requests.push(r.url()))
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(APP)
  await page.waitForSelector('.app')
  return { ctx, page, requests, errors }
}
async function addActivity(page, name) {
  await page.getByRole('button', { name: 'Neue Aktivität' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Name', { exact: true }).fill(name)
  await dlg.getByRole('button', { name: 'Anlegen' }).click()
  await dlg.waitFor({ state: 'detached' })
}

let pc, phone
await test('…/momentum ohne Schrägstrich leitet auf …/momentum/ weiter', async () => {
  const r = await fetch(`${ORIGIN}/momentum`, { redirect: 'manual' })
  if (r.status !== 301 || r.headers.get('location') !== '/momentum/') throw new Error(`status ${r.status} ${r.headers.get('location')}`)
})

await test('App lädt unter /momentum/, Version 1, Bridge direkt (kein Host-Hinweis)', async () => {
  pc = await newPage()
  phone = await newPage({ ...devices['Pixel 7'] })
  for (const d of [pc, phone]) {
    await d.page.goto(`${APP}#/settings`)
    await d.page.getByTestId('update-test').filter({ hasText: 'Build 1' }).waitFor()
    await d.page.getByText(`Direkt mit Bridge verbunden: ${ORIGIN}`).waitFor()
    if (await d.page.getByText('Kein Momentum-Host erreichbar').count()) throw new Error('alter Host-Hinweis sichtbar')
    if (await d.page.getByText('darf der Browser nicht direkt').count()) throw new Error('Hinweis „nicht direkt“ sichtbar')
  }
  // the service worker takes control on the first visit (clientsClaim)
  await phone.page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 15_000 })
})

await test('zwei Browser synchronisieren direkt über Bridge (ohne /bridge-Weiterleitung)', async () => {
  const id = `direct-${Date.now()}`
  await pc.page.goto(`${APP}#/today`)
  await addActivity(pc.page, 'Vom PC direkt')
  for (const [d, name] of [[pc, 'PC'], [phone, 'Handy']]) {
    await d.page.goto(`${APP}#/settings`)
    await d.page.locator('#sync-id').fill(id)
    await d.page.locator('#sync-device').fill(name)
    await d.page.getByRole('button', { name: 'Synchronisation starten' }).click()
    await d.page.getByText('Synchronisation gestartet').waitFor()
  }
  await phone.page.goto(`${APP}#/activities`)
  await phone.page.getByRole('link', { name: /Vom PC direkt/ }).waitFor({ timeout: 60_000 })
  const direct = phone.requests.some((u) => u.startsWith(`${ORIGIN}/message/poll`) || u.startsWith(`${ORIGIN}/client/`))
  const proxied = phone.requests.some((u) => u.includes('/bridge/'))
  if (!direct || proxied) throw new Error(`direct=${direct} proxied=${proxied}`)
})

await test('neue Version im Release -> Host lädt sie -> App zeigt „Aktualisieren“ -> Version 2, Daten bleiben', async () => {
  feedBuild = 2
  await waitFor(async () => (await info()).web.build === 2, 30_000, 'host lädt Version 2')
  await phone.page.goto(`${APP}#/settings`)
  await phone.page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r?.update()))
  const btn = phone.page.getByRole('button', { name: 'Aktualisieren' }).first()
  await btn.waitFor({ timeout: 30_000 })
  await btn.click()

  try {
    await phone.page.getByTestId('update-test').filter({ hasText: 'Build 2' }).waitFor({ timeout: 30_000 })
  } catch (e) {
    const diag = await phone.page.evaluate(async () => {
      const r = await navigator.serviceWorker.getRegistration()
      return { text: document.querySelector('[data-testid=update-test]')?.textContent, active: r?.active?.state, waiting: !!r?.waiting, installing: !!r?.installing, controller: !!navigator.serviceWorker.controller }
    })
    throw new Error(`${e.message}\n${JSON.stringify(diag)}`)
  }
  await phone.page.goto(`${APP}#/activities`)
  await phone.page.getByRole('link', { name: /Vom PC direkt/ }).waitFor()
})

await test('keine Fehler im Browser', async () => {
  const errs = [...pc.errors, ...phone.errors]
  if (errs.length) throw new Error(errs.join('\n'))
})

await browser.close()
host.kill()
feed.close()
const failed = results.filter((r) => !r).length
if (failed) console.log(`\nHost-Log:\n${hostLog.split('\n').slice(-15).join('\n')}`)
console.log(`\n${results.length - failed}/${results.length} E2E tests passed`)
process.exit(failed ? 1 : 0)
