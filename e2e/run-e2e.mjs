/**
 * End-to-end tests against the production build (incl. service worker).
 *
 *   npm run build && npm run test:e2e
 *
 * Uses the `playwright` library directly (no test runner) so it runs anywhere Chromium is
 * available. Time is frozen to Tue 2026-11-03 08:30 Europe/Berlin; the demo fixture is
 * generated for the same date (see e2e/make-demo.ts).
 */
import { chromium, devices } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const OUT = join(here, 'output')
const FIXTURE = join(here, 'fixtures', 'demo-backup.json')
const NOW = new Date('2026-11-03T08:30:00+01:00')
mkdirSync(OUT, { recursive: true })

// The app is served by the Momentum-Host (static files + /bridge proxy + push API, push in dry-run).
// Sync tests need a Bridge server: BRIDGE_TEST_URL=http://127.0.0.1:8002 npm run test:e2e
const BRIDGE = process.env.BRIDGE_TEST_URL
const host = spawn(process.execPath, [join(here, '..', 'host', 'server.mjs')], {
  env: { ...process.env, MOMENTUM_PORT: '4199', BRIDGE_URL: BRIDGE || 'http://127.0.0.1:9', MOMENTUM_DATA: mkdtempSync(join(tmpdir(), 'momentum-host-')), MOMENTUM_PUSH_DRYRUN: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
await new Promise((resolve) => host.stdout.on('data', (d) => String(d).includes('läuft') && resolve()))
const BASE = 'http://localhost:4199/'
const browser = await chromium.launch()

const results = []
let currentErrors = []

async function newPage(opts = {}) {
  const ctx = await browser.newContext({ locale: 'de-DE', timezoneId: 'Europe/Berlin', viewport: { width: 1360, height: 900 }, acceptDownloads: true, ...opts })
  const page = await ctx.newPage()
  await page.clock.setFixedTime(NOW)
  page.on('pageerror', (e) => currentErrors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => m.type() === 'error' && currentErrors.push(`console: ${m.text()}`))
  await page.goto(BASE)
  await page.waitForSelector('.app')
  return { ctx, page }
}

function expect(cond, message) {
  if (!cond) throw new Error(message)
}

async function test(name, fn) {
  currentErrors = []
  const t0 = Date.now()
  try {
    await fn()
    if (currentErrors.length) throw new Error(`browser errors:\n  ${currentErrors.join('\n  ')}`)
    results.push({ name, ok: true, ms: Date.now() - t0 })
    console.log(`  ✓ ${name}`)
  } catch (e) {
    results.push({ name, ok: false, error: e.message })
    console.log(`  ✗ ${name}\n      ${e.message.split('\n').join('\n      ')}`)
  }
}

const occRow = (page, name) => page.locator('li.occ', { has: page.locator('.occ-name', { hasText: new RegExp(`^${name}$`) }) })

async function createActivity(page, { name, kind, target, unit, preset, weekdays, time }) {
  await page.getByRole('button', { name: 'Neue Aktivität' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Name', { exact: true }).fill(name)
  if (kind) await dlg.getByRole('button', { name: kind, exact: true }).click()
  if (target !== undefined) await dlg.getByLabel('Ziel', { exact: true }).fill(String(target))
  if (unit) await dlg.getByLabel('Einheit').fill(unit)
  if (preset) await dlg.getByRole('button', { name: preset, exact: true }).click()
  if (weekdays) {
    const group = dlg.getByRole('group', { name: 'An' })
    for (const b of await group.getByRole('button').all()) {
      const label = (await b.textContent()).trim()
      const want = weekdays.includes(label)
      const on = (await b.getAttribute('aria-pressed')) === 'true'
      if (want !== on) await b.click()
    }
  }
  if (time) await dlg.getByLabel('Uhrzeit').first().fill(time)
  await dlg.getByRole('button', { name: 'Anlegen' }).click()
  await dlg.waitFor({ state: 'detached' })
}

async function createActivityMobile(page, name) {
  await page.getByRole('button', { name: 'Neue Aktivität' }).first().click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Name', { exact: true }).fill(name)
  await dlg.getByRole('button', { name: 'Anlegen' }).click()
  await dlg.waitFor({ state: 'detached' })
}

async function importDemo(page) {
  await page.goto(BASE + '#/settings')
  await page.setInputFiles('input[type=file]', FIXTURE)
  await page.getByRole('button', { name: /Zusammenführen/ }).click()
  await page.getByText(/Datensätze importiert/).waitFor()
}

console.log('\nMomentum E2E')

await test('empty state, welcome screen and no console errors', async () => {
  const { ctx, page } = await newPage()
  await page.getByText('Willkommen bei Momentum').waitFor()
  expect(await page.getByRole('button', { name: 'Erste Aktivität anlegen' }).isVisible(), 'welcome CTA missing')
  for (const path of ['calendar', 'activities', 'stats', 'review', 'achievements', 'settings']) {
    await page.goto(BASE + '#/' + path)
    await page.waitForSelector('.page-title')
  }
  await page.goto(BASE + '#/stats')
  await page.getByText('Sobald du Termine erledigst').waitFor()
  await ctx.close()
})

await test('create, complete, undo, persist, edit, archive and delete activities', async () => {
  const { ctx, page } = await newPage()
  await createActivity(page, { name: 'Dehnen', time: '07:15' })
  await createActivity(page, { name: 'Japanisch', kind: 'Dauer', target: 15, preset: 'Wöchentlich', weekdays: ['Mo', 'Mi', 'Fr'] })
  await createActivity(page, { name: 'Lesen', kind: 'Anzahl', target: 10, unit: 'Seiten' })
  await page.goto(BASE + '#/today')
  // Tuesday: Japanese (Mon/Wed/Fri) is not scheduled
  expect(await occRow(page, 'Dehnen').count() === 1, 'Dehnen not on today')
  expect(await occRow(page, 'Japanisch').count() === 0, 'Japanisch must not be scheduled on Tuesday')
  expect(await page.getByText('Morgens').isVisible(), 'time-of-day section missing')
  // complete + undo
  await page.getByRole('button', { name: 'Dehnen: Als erledigt markieren' }).click()
  await page.getByText('1 von 2 erledigt').waitFor()
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await page.getByText('0 von 2 erledigt').waitFor()
  await page.getByRole('button', { name: 'Dehnen: Als erledigt markieren' }).click()
  await page.getByText('1 von 2 erledigt').waitFor()
  // measurable: partial then goal
  await page.getByRole('button', { name: 'Lesen: Fortschritt eintragen' }).click()
  let dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: '+5 Seiten' }).click()
  await dlg.getByRole('button', { name: 'Speichern' }).click()
  await occRow(page, 'Lesen').getByText('Teilweise').waitFor()
  await page.getByRole('button', { name: 'Lesen: Fortschritt eintragen' }).click()
  dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Ziel erreicht' }).click()
  await dlg.getByRole('button', { name: 'Speichern' }).click()
  await page.getByText('Alles geschafft').waitFor()
  // persistence across reload
  await page.reload()
  await page.getByText('Alles geschafft').waitFor()
  // next day: Japanese appears and is locked (future)
  await page.getByRole('button', { name: 'Weiter' }).first().click()
  await occRow(page, 'Japanisch').waitFor()
  expect(await page.getByRole('button', { name: 'Japanisch: Noch nicht fällig' }).isDisabled(), 'future occurrence must not be completable')
  // edit name via detail page
  await page.goto(BASE + '#/activities')
  await page.getByRole('link', { name: /Dehnen/ }).click()
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  dlg = page.getByRole('dialog')
  await dlg.getByLabel('Name', { exact: true }).fill('Dehnen am Morgen')
  await dlg.getByRole('button', { name: 'Speichern' }).click()
  await page.getByRole('heading', { name: 'Dehnen am Morgen' }).waitFor()
  // archive Lesen
  await page.goto(BASE + '#/activities')
  await page.getByRole('link', { name: /Lesen/ }).click()
  await page.getByRole('button', { name: 'Archivieren' }).click()
  await page.goto(BASE + '#/today')
  await page.waitForSelector('li.occ')
  expect(await occRow(page, 'Lesen').count() === 1, 'archived today with progress keeps today (history)')
  await page.goto(BASE + '#/today?d=2026-11-04')
  await occRow(page, 'Japanisch').waitFor()
  expect(await occRow(page, 'Lesen').count() === 0, 'archived activity must not be scheduled in future')
  await page.goto(BASE + '#/activities?status=archived')
  await page.getByRole('link', { name: /Lesen/ }).waitFor()
  // delete Japanisch + undo
  await page.goto(BASE + '#/activities')
  await page.getByRole('link', { name: /Japanisch/ }).click()
  await page.getByRole('button', { name: 'Löschen' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click()
  await page.getByText('„Japanisch“ gelöscht').waitFor()
  expect(await page.getByRole('link', { name: /Japanisch/ }).count() === 0, 'deleted activity still listed')
  await page.getByRole('button', { name: 'Rückgängig' }).click()
  await page.getByRole('link', { name: /Japanisch/ }).waitFor()
  await page.screenshot({ path: join(OUT, 'activities.png') })
  await ctx.close()
})

await test('keyboard shortcuts, theme and language persist', async () => {
  const { ctx, page } = await newPage()
  await page.keyboard.press('n')
  await page.getByRole('dialog', { name: 'Neue Aktivität' }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  await page.keyboard.press('2')
  await page.waitForURL(/#\/calendar/)
  await page.goto(BASE + '#/settings')
  await page.getByRole('button', { name: 'Dunkel' }).click()
  await page.getByRole('button', { name: 'English' }).click()
  await page.reload()
  await page.waitForSelector('.app')
  expect((await page.getAttribute('html', 'data-theme')) === 'dark', 'dark theme not persisted')
  await page.getByRole('heading', { name: 'Settings' }).waitFor()
  await page.getByRole('button', { name: 'Deutsch' }).click()
  await page.getByRole('button', { name: 'Hell' }).click()
  await ctx.close()
})

await test('import demo data: streaks, stats, review, achievements, heatmap', async () => {
  const { ctx, page } = await newPage()
  await importDemo(page)
  await page.goto(BASE + '#/today')
  await page.getByText('Aktuelle Serien').waitFor()
  const streak = await page.locator('.streak-list .streak-count').first().textContent()
  expect(Number(streak.trim()) >= 9, `expected a running streak, got ${streak}`)
  await page.goto(BASE + '#/stats')
  await page.getByText('Erfüllungsquote').waitFor()
  const rate = await page.locator('.kpi-value').first().textContent()
  expect(/\d+\s?%/.test(rate), `rate missing: ${rate}`)
  expect((await page.locator('.heat-cell.l4').count()) > 10, 'heatmap has no completed days')
  await page.getByRole('combobox', { name: 'Aktivität' }).selectOption({ label: 'Japanisch' })
  expect((await page.locator('table tbody tr').count()) === 1, 'activity filter did not apply')
  await page.screenshot({ path: join(OUT, 'stats.png'), fullPage: true })
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'CSV exportieren' }).click()
  const file = await (await dl).path()
  expect(readFileSync(file, 'utf8').includes('date,planned,done'), 'CSV header missing')
  await page.goto(BASE + '#/review?w=2026-10-26')
  await page.getByText(/geplanten Terminen geschafft/).waitFor()
  await page.goto(BASE + '#/achievements')
  expect((await page.locator('.badge-card.unlocked').count()) >= 3, 'achievements not derived')
  await ctx.close()
})

await test('recurring edit scopes: "from today" keeps history, single occurrence move & skip', async () => {
  const { ctx, page } = await newPage()
  await importDemo(page)
  await page.goto(BASE + '#/activity/demo-japanese')
  const before = await page.locator('.kpi-value').nth(1).textContent()
  await page.getByRole('button', { name: 'Bearbeiten' }).click()
  let dlg = page.getByRole('dialog')
  await dlg.getByLabel('Ziel', { exact: true }).fill('20')
  await dlg.getByRole('button', { name: 'Speichern' }).click()
  await page.getByRole('dialog', { name: 'Für welche Termine?' }).getByRole('button', { name: /Ab heute/ }).click()
  await page.getByText('Planänderungen').waitFor()
  expect((await page.locator('.detail-columns .mini-list').nth(1).locator('li').count()) === 2, 'expected 2 schedule segments')
  const after = await page.locator('.kpi-value').nth(1).textContent()
  expect(before === after, `streak changed by schedule edit: ${before} -> ${after}`)
  // move tomorrow's (Wed) occurrence to Thursday via occurrence sheet
  await page.goto(BASE + '#/today?d=2026-11-04')
  await occRow(page, 'Japanisch').locator('.occ-main').click()
  dlg = page.getByRole('dialog')
  await dlg.getByRole('button', { name: 'Verschieben' }).click()
  await page.getByRole('dialog', { name: 'Termin verschieben' }).getByLabel('Neues Datum').fill('2026-11-05')
  await page.getByRole('dialog', { name: 'Termin verschieben' }).getByRole('button', { name: 'Verschieben' }).click()
  await page.getByText(/Verschoben auf/).waitFor()
  await page.keyboard.press('Escape')
  await page.goto(BASE + '#/today?d=2026-11-05')
  await occRow(page, 'Japanisch').getByText(/verschoben vom/).waitFor()
  await page.goto(BASE + '#/today?d=2026-11-06')
  await occRow(page, 'Japanisch').waitFor() // the series itself is untouched
  // skip
  await occRow(page, 'Japanisch').locator('.occ-main').click()
  await page.getByRole('dialog').getByRole('button', { name: 'Aussetzen' }).click()
  await page.keyboard.press('Escape')
  await page.locator('li.occ.status-skipped').waitFor()
  await ctx.close()
})

await test('calendar: month/week/day views, create from date, drag to move', async () => {
  const { ctx, page } = await newPage()
  await importDemo(page)
  await page.goto(BASE + '#/calendar?view=month')
  await page.locator('.cal-chip').first().waitFor()
  await page.locator('.cal-cell[aria-label^="Donnerstag, 12. November"] .cal-num').click()
  await page.locator('.cal-day-panel').getByText('12. November').waitFor()
  await page.locator('.cal-day-panel').getByRole('button', { name: 'Hier anlegen' }).click()
  const dlg = page.getByRole('dialog')
  await dlg.getByLabel('Name', { exact: true }).fill('Zahnarzt')
  expect((await dlg.getByRole('button', { name: 'Einmalig', exact: true }).getAttribute('aria-pressed')) === 'true', 'calendar create should default to one-time')
  await dlg.getByRole('button', { name: 'Anlegen' }).click()
  await page.locator('.cal-day-panel').getByText('Zahnarzt').waitFor()
  await page.getByRole('button', { name: 'Woche', exact: true }).click()
  await page.locator('.cal-week-day').first().waitFor()
  // drag Zahnarzt is not in this week; drag first chip of Wednesday to Thursday
  await page.goto(BASE + '#/calendar?view=week&d=2026-11-12')
  const chip = page.locator('.cal-week-day').nth(3).locator('.cal-chip', { hasText: 'Zahnarzt' })
  await chip.dragTo(page.locator('.cal-week-day').nth(4))
  await page.getByText(/Verschoben auf/).waitFor()
  await page.locator('.cal-week-day').nth(4).locator('.cal-chip', { hasText: 'Zahnarzt' }).waitFor()
  await page.screenshot({ path: join(OUT, 'calendar-week.png') })
  await page.getByRole('button', { name: 'Tag', exact: true }).click()
  await page.locator('.cal-day').waitFor()
  await ctx.close()
})

await test('export JSON and reject invalid imports', async () => {
  const { ctx, page } = await newPage()
  await importDemo(page)
  await page.goto(BASE + '#/settings')
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Backup exportieren (JSON)' }).click()
  const json = JSON.parse(readFileSync(await (await dl).path(), 'utf8'))
  expect(json.format === 'momentum-export' && json.data.activities.length === 6, 'export content wrong')
  await page.setInputFiles('input[type=file]', { name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":1}') })
  await page.getByText('Das ist kein Momentum-Backup.').waitFor()
  await ctx.close()
})

await test('responsive: mobile layout without horizontal overflow', async () => {
  const { ctx, page } = await newPage({ ...devices['iPhone 13'] })
  await importDemo(page)
  for (const path of ['today', 'calendar', 'calendar?view=week', 'activities', 'activity/demo-reading', 'stats', 'review', 'achievements', 'settings', 'more']) {
    await page.goto(BASE + '#/' + path)
    await page.waitForSelector('.page-title, .page')
    await page.waitForTimeout(150)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow <= 1, `horizontal overflow of ${overflow}px on ${path}`)
    expect(await page.locator('.bottom-nav').isVisible(), 'bottom nav hidden on mobile')
    expect(!(await page.locator('.sidebar').isVisible()), 'sidebar visible on mobile')
  }
  await page.goto(BASE + '#/today')
  await page.screenshot({ path: join(OUT, 'mobile-today.png') })
  // swipe gesture changes the day
  await page.evaluate(() => {
    const el = document.querySelector('.page')
    const t = (x) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 })
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t(300)], changedTouches: [t(300)], bubbles: true }))
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], changedTouches: [t(120)], bubbles: true }))
  })
  await page.waitForURL(/d=2026-11-04/)
  // bottom-sheet editor
  await page.getByRole('button', { name: 'Neue Aktivität' }).click()
  await page.getByRole('dialog').waitFor()
  await page.screenshot({ path: join(OUT, 'mobile-editor.png') })
  await ctx.close()
})

await test('PWA: manifest, service worker and offline usage', async () => {
  const { ctx, page } = await newPage()
  const manifest = await (await page.request.get(BASE + 'manifest.webmanifest')).json()
  expect(manifest.display === 'standalone' && manifest.icons.some((i) => i.purpose === 'maskable'), 'manifest incomplete')
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await page.reload() // let the SW control the page
  await page.evaluate(async () => navigator.serviceWorker.ready)
  await createActivity(page, { name: 'Offline-Test' })
  await ctx.setOffline(true)
  await page.reload()
  await page.waitForSelector('.app')
  await occRow(page, 'Offline-Test').waitFor()
  await page.getByRole('button', { name: 'Offline-Test: Als erledigt markieren' }).click()
  await page.getByText('Alles geschafft').waitFor()
  await page.goto(BASE + '#/stats')
  await page.getByText('Erfüllungsquote').waitFor()
  expect(await page.locator('.offline-pill').isVisible(), 'offline indicator missing')
  await ctx.close()
})

await test('notification "done" action and time zone setting', async () => {
  const { ctx, page } = await newPage()
  await importDemo(page)
  await page.goto(BASE + '#/today?done=demo-gym_2026-11-03')
  await occRow(page, 'Training').locator('.check-box svg').waitFor()
  expect(!(await page.url()).includes('done='), 'done param should be removed')
  await page.goto(BASE + '#/settings')
  await page.getByLabel(/Zeitzone/).selectOption('Asia/Tokyo')
  await page.goto(BASE + '#/today')
  // 08:30 Berlin = 16:30 Tokyo on the same day -> afternoon greeting
  await page.getByRole('heading', { name: /Hallo/ }).waitFor()
  await page.goto(BASE + '#/settings')
  await page.getByText('Push-Benachrichtigungen').waitFor()
  const info = await page.evaluate(async () => (await fetch('momentum-host/info')).json())
  expect(info.app === 'momentum-host' && info.push.publicKey.length > 40, 'host info missing')
  await ctx.close()
})

await (BRIDGE ? test : async (name) => console.log(`  - ${name} (übersprungen: BRIDGE_TEST_URL fehlt)`))('sync between two devices through the host proxy and Bridge (merge choice)', async () => {
  const id = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
  const pc = await newPage()
  const phone = await newPage({ ...devices['Pixel 7'] })
  // PC: demo data, phone: own activity -> both have data
  await importDemo(pc.page)
  await createActivityMobile(phone.page, 'Vom Handy')
  // the phone joins the group 5 minutes after the PC (both pages otherwise share the fixed test clock)
  await phone.page.clock.setFixedTime(new Date(NOW.getTime() + 5 * 60_000))
  for (const [d, name] of [[pc, 'PC'], [phone, 'Handy']]) {
    await d.page.goto(BASE + '#/settings')
    await d.page.locator('#sync-id').fill(id)
    await d.page.locator('#sync-device').fill(name)
    await d.page.getByRole('button', { name: 'Synchronisation starten' }).click()
    await d.page.getByText('Synchronisation gestartet').waitFor()
  }
  // the newer device (phone) is asked how to combine the data
  await phone.page.getByRole('dialog', { name: 'Wie sollen die Daten zusammenkommen?' }).waitFor({ timeout: 60_000 })
  await phone.page.screenshot({ path: join(OUT, 'sync-choice.png') })
  await phone.page.getByRole('button', { name: /Zusammenführen/ }).click()
  await phone.page.goto(BASE + '#/activities')
  await phone.page.getByRole('link', { name: /Japanisch/ }).waitFor({ timeout: 60_000 })
  await pc.page.goto(BASE + '#/activities')
  await pc.page.getByRole('link', { name: /Vom Handy/ }).waitFor({ timeout: 60_000 })
  // live change: tick on the phone -> appears on the PC
  await phone.page.goto(BASE + '#/today')
  await phone.page.getByRole('button', { name: 'Vom Handy: Als erledigt markieren' }).click()
  await pc.page.goto(BASE + '#/today')
  await pc.page.locator('li.occ.status-done', { hasText: 'Vom Handy' }).waitFor({ timeout: 60_000 })
  await pc.page.goto(BASE + '#/settings')
  await pc.page.locator('.peer-list', { hasText: 'Handy' }).waitFor()
  await pc.page.screenshot({ path: join(OUT, 'sync-settings.png'), fullPage: true })
  await pc.ctx.close()
  await phone.ctx.close()
})

await browser.close()
host.kill()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} E2E tests passed`)
process.exit(failed.length ? 1 : 0)
