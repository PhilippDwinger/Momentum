#!/usr/bin/env node
/**
 * Momentum-Host – runs on your PC next to Bridge (nothing in Bridge is changed).
 *
 *  1. serves the browser app under the Bridge address: https://muttchen.tail91b057.ts.net:8443/momentum/
 *     (Tailscale maps the path /momentum of Bridge's port to this host, set up automatically).
 *     Same address as Bridge = the browser may talk to Bridge directly (Bridge sends no CORS
 *     headers, so from any other address it could not). The host does NOT sync anything – the
 *     devices talk to each other through Bridge.
 *  2. keeps the app up to date: downloads every new build from GitHub Releases (pwa.json.gz,
 *     sha256-checked); open apps update themselves ("Aktualisieren").
 *  3. sends Web Push notifications. Devices upload their notification plan (texts are generated
 *     on the device), the host delivers each item at its time – also when the app is closed.
 *  4. /bridge/* = 1:1 forwarding to Bridge for app copies opened elsewhere (e.g. http://localhost:5180).
 *
 * Config via environment variables (defaults in brackets):
 *   MOMENTUM_PORT   [5180]           MOMENTUM_BIND [127.0.0.1]
 *   BRIDGE_URL      [https://muttchen.tail91b057.ts.net:8443]
 *   MOMENTUM_DIST   [<repo>/dist]    MOMENTUM_DATA [<repo>/host/data]
 *   MOMENTUM_UPDATE_URL [GitHub latest.json of PhilippDwinger/Momentum; '' = off]
 *   MOMENTUM_UPDATE_SECONDS [300]    MOMENTUM_TAILSCALE [auto on Windows, off elsewhere]
 *   MOMENTUM_PUSH_DRYRUN=1           log pushes instead of sending (tests)
 *   MOMENTUM_ROOT_PROXY=1            tests: everything outside /momentum goes to Bridge (like Tailscale)
 */
import { createServer } from 'node:http'
import { readFile, writeFile, rename, mkdir, stat, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize, resolve, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { execFile } from 'node:child_process'
import webpush from 'web-push'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = {
  port: Number(process.env.MOMENTUM_PORT || 5180),
  bind: process.env.MOMENTUM_BIND || '127.0.0.1',
  bridge: (process.env.BRIDGE_URL || 'https://muttchen.tail91b057.ts.net:8443').replace(/\/+$/, ''),
  dist: resolve(process.env.MOMENTUM_DIST || join(here, '..', 'dist')),
  data: resolve(process.env.MOMENTUM_DATA || join(here, 'data')),
  dryRun: process.env.MOMENTUM_PUSH_DRYRUN === '1',
  updateUrl: process.env.MOMENTUM_UPDATE_URL ?? 'https://github.com/PhilippDwinger/Momentum/releases/latest/download/latest.json',
  updateEvery: Math.max(5, Number(process.env.MOMENTUM_UPDATE_SECONDS || 300)) * 1000,
  tailscale: process.env.MOMENTUM_TAILSCALE || (process.platform === 'win32' ? 'auto' : 'off'),
  rootProxy: process.env.MOMENTUM_ROOT_PROXY === '1',
}
const VERSION = '1.2.0'
const MOUNT = '/momentum'
const MAX_BODY = 2 * 1024 * 1024
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a)

// ---------------------------------------------------------------------------
// state (push subscriptions + plans), persisted as JSON
// ---------------------------------------------------------------------------
const stateFile = join(cfg.data, 'push-state.json')
let state = { vapid: null, groups: {} }
let saveTimer = null

async function loadState() {
  await mkdir(cfg.data, { recursive: true })
  if (existsSync(stateFile)) {
    try {
      state = JSON.parse(await readFile(stateFile, 'utf8'))
    } catch (e) {
      log('push-state.json unreadable, starting fresh:', e.message)
    }
  }
  state.groups ??= {}
  if (!state.vapid) {
    state.vapid = webpush.generateVAPIDKeys()
    await saveNow()
    log('generated new VAPID keys')
  }
  webpush.setVapidDetails('mailto:momentum-host@localhost', state.vapid.publicKey, state.vapid.privateKey)
}

async function saveNow() {
  const tmp = `${stateFile}.tmp`
  await writeFile(tmp, JSON.stringify(state))
  await rename(tmp, stateFile)
}
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => saveNow().catch((e) => log('save failed', e.message)), 300)
}
const group = (id) => (state.groups[id] ??= { subs: {}, items: [] })

// ---------------------------------------------------------------------------
// push delivery
// ---------------------------------------------------------------------------
async function deliver(groupId, item, onlyDevice) {
  const g = state.groups[groupId]
  if (!g) return 0
  let ok = 0
  const payload = JSON.stringify({ title: item.title, body: item.body, tag: item.tag, url: item.url, occKey: item.occKey, kind: item.kind })
  for (const [device, sub] of Object.entries(g.subs)) {
    if (onlyDevice && device !== onlyDevice) continue
    if (cfg.dryRun) {
      log(`[dry-run] push to ${groupId.slice(0, 8)}/${device.slice(0, 8)}: ${item.title} – ${item.body}`)
      ;(g.sentLog ??= []).push({ device, id: item.id, title: item.title, body: item.body, at: Date.now() })
      g.sentLog = g.sentLog.slice(-50)
      ok++
      continue
    }
    try {
      await webpush.sendNotification(sub.subscription, payload, { TTL: 6 * 3600, urgency: 'high', topic: (item.tag || '').replace(/[^\w-]/g, '').slice(0, 32) || undefined })
      ok++
    } catch (e) {
      const code = e.statusCode
      log(`push failed (${code ?? e.message}) for ${device.slice(0, 8)}`)
      if (code === 404 || code === 410) delete g.subs[device] // subscription is gone
    }
  }
  save()
  return ok
}

async function tick() {
  const now = Date.now()
  for (const [gid, g] of Object.entries(state.groups)) {
    for (const item of g.items) {
      if (item.sent || item.at > now) continue
      item.sent = now
      if (now - item.at > 30 * 60 * 1000) continue // too late – skip silently
      const n = await deliver(gid, item)
      log(`sent "${item.title}" to ${n} device(s)`)
    }
    g.items = g.items.filter((i) => i.at > now - 2 * 24 * 3600 * 1000)
    if (Object.keys(g.subs).length === 0 && g.items.length === 0) delete state.groups[gid]
  }
  save()
}

// ---------------------------------------------------------------------------
// validation helpers
// ---------------------------------------------------------------------------
const isId = (s) => typeof s === 'string' && /^[\w:-]{8,128}$/.test(s)
const str = (s, max) => (typeof s === 'string' ? s.slice(0, max) : '')

function cleanItems(items) {
  if (!Array.isArray(items)) return []
  const now = Date.now()
  return items
    .slice(0, 400)
    .filter((i) => i && typeof i.id === 'string' && Number.isFinite(i.at) && i.at > now - 3600e3 && i.at < now + 15 * 86400e3)
    .map((i) => ({
      id: str(i.id, 200),
      at: i.at,
      title: str(i.title, 120),
      body: str(i.body, 400),
      tag: str(i.tag, 120),
      url: typeof i.url === 'string' && i.url.startsWith('./') ? str(i.url, 300) : './',
      occKey: i.occKey ? str(i.occKey, 200) : undefined,
      kind: str(i.kind, 20),
    }))
}

// ---------------------------------------------------------------------------
// app files: newest build from GitHub (auto-update), otherwise the local dist/
// ---------------------------------------------------------------------------
const webDir = join(cfg.data, 'web')
let web = { build: 0, version: '', dir: null, checkedAt: 0, error: null }

async function loadWebState() {
  try {
    const cur = JSON.parse(await readFile(join(webDir, 'current.json'), 'utf8'))
    if (cur.dir && existsSync(join(cur.dir, 'index.html'))) web = { ...web, build: cur.build, version: cur.version, dir: cur.dir }
  } catch {
    /* none yet */
  }
}
const webRoot = () => web.dir || cfg.dist

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

async function checkWebUpdate() {
  if (!cfg.updateUrl) return
  web.checkedAt = Date.now()
  try {
    const r = await fetch(`${cfg.updateUrl}${cfg.updateUrl.includes('?') ? '&' : '?'}t=${Date.now()}`, { headers: { 'cache-control': 'no-cache' }, signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`latest.json HTTP ${r.status}`)
    const latest = await r.json()
    if (!Number.isInteger(latest.build) || typeof latest.pwa !== 'string' || !/^[0-9a-f]{64}$/.test(latest.pwaSha256 || '')) throw new Error('latest.json ohne Web-Version')
    if (latest.build <= web.build) {
      web.error = null
      return
    }
    const z = await fetch(latest.pwa, { signal: AbortSignal.timeout(90_000) })
    if (!z.ok) throw new Error(`pwa.json.gz HTTP ${z.status}`)
    const buf = Buffer.from(await z.arrayBuffer())
    if (sha256(buf) !== latest.pwaSha256) throw new Error('Prüfsumme stimmt nicht')
    const pack = JSON.parse(gunzipSync(buf).toString('utf8'))
    if (pack.format !== 'momentum-web-1' || !pack.files?.['index.html']) throw new Error('unbekanntes Paketformat')
    const dir = join(webDir, `build-${latest.build}`)
    await rm(dir, { recursive: true, force: true })
    for (const [rel, b64] of Object.entries(pack.files)) {
      const target = normalize(join(dir, rel))
      if (!target.startsWith(dir + sep) || rel.includes('..')) throw new Error(`unsicherer Pfad im Paket: ${rel}`)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, Buffer.from(b64, 'base64'))
    }
    const prev = web.dir
    web = { ...web, build: latest.build, version: latest.version || '', dir, error: null }
    await writeFile(join(webDir, 'current.json'), JSON.stringify({ build: web.build, version: web.version, dir }))
    log(`Neue App-Version ${web.version || web.build} geladen – offene Apps zeigen „Aktualisieren“`)
    // keep the current and the previous build
    for (const name of await readdir(webDir)) {
      const p = join(webDir, name)
      if (name.startsWith('build-') && p !== dir && p !== prev) await rm(p, { recursive: true, force: true })
    }
  } catch (e) {
    web.error = e.message
    log(`Update-Prüfung: ${e.message}`)
  }
}

// ---------------------------------------------------------------------------
// Tailscale: map https://<bridge-host>:<port>/momentum -> this host (Bridge itself unchanged)
// ---------------------------------------------------------------------------
let tsState = 'off'

function tailscale(args) {
  const exes = process.platform === 'win32' ? ['tailscale', 'C:\\Program Files\\Tailscale\\tailscale.exe'] : ['tailscale']
  return new Promise((resolveRun, rejectRun) => {
    const attempt = (i) =>
      execFile(exes[i], args, { timeout: 20_000, windowsHide: true }, (err, stdout, stderr) => {
        if (err && err.code === 'ENOENT' && i + 1 < exes.length) return attempt(i + 1)
        if (err) return rejectRun(new Error((stderr || err.message).trim()))
        resolveRun(stdout)
      })
    attempt(0)
  })
}

async function ensureTailscale() {
  if (cfg.tailscale === 'off') return
  let bridge
  try {
    bridge = new URL(cfg.bridge)
  } catch {
    return
  }
  if (!bridge.hostname.endsWith('.ts.net')) return
  const port = bridge.port || '443'
  const hp = `${bridge.hostname}:${port}`
  const target = `http://127.0.0.1:${cfg.port}`
  try {
    const status = JSON.parse((await tailscale(['serve', 'status', '--json'])) || '{}')
    const handlers = status?.Web?.[hp]?.Handlers ?? {}
    const mounted = Object.entries(handlers).find(([k]) => k.replace(/\/+$/, '') === MOUNT)
    if (mounted && mounted[1]?.Proxy?.replace(/\/+$/, '') === target) {
      tsState = 'ok'
      return
    }
    // same visibility as Bridge's own port: public (Funnel) if Bridge is public, else tailnet only
    const funnel = !!status?.AllowFunnel?.[hp]
    await tailscale([funnel ? 'funnel' : 'serve', '--bg', `--https=${port}`, `--set-path=${MOUNT}`, target])
    tsState = 'ok'
    log(`Tailscale: ${bridge.origin}${MOUNT}/ -> ${target}${funnel ? ' (öffentlich, wie Bridge)' : ' (nur im Tailnet, wie Bridge)'}`)
  } catch (e) {
    if (tsState !== 'error') log(`Tailscale-Weiterleitung nicht eingerichtet (${e.message}). Von Hand: tailscale funnel --bg --https=${port} --set-path=${MOUNT} ${target}`)
    tsState = 'error'
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body)
  res.writeHead(status, { 'content-type': typeof body === 'object' && !Buffer.isBuffer(body) ? 'application/json' : 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', ...headers })
  res.end(data)
}

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > MAX_BODY) throw Object.assign(new Error('body too large'), { status: 413 })
    chunks.push(c)
  }
  return Buffer.concat(chunks)
}

async function proxyBridge(req, res, path) {
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
  const headers = { 'content-type': req.headers['content-type'] || 'application/json', accept: 'application/json' }
  const fwd = req.socket.remoteAddress
  if (fwd) headers['x-forwarded-for'] = req.headers['x-forwarded-for'] ? `${req.headers['x-forwarded-for']}, ${fwd}` : fwd
  try {
    const r = await fetch(cfg.bridge + path, { method: req.method, headers, body, signal: AbortSignal.timeout(45_000) })
    const buf = Buffer.from(await r.arrayBuffer())
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' })
    res.end(buf)
  } catch (e) {
    send(res, 502, { detail: { error: 'BRIDGE_UNREACHABLE', name: 'Bridge unreachable', message: `Momentum-Host erreicht Bridge nicht (${cfg.bridge}): ${e.message}` } })
  }
}

async function handleApi(req, res, path) {
  if (path === '/info') {
    return send(res, 200, {
      app: 'momentum-host',
      version: VERSION,
      bridge: cfg.bridge,
      web: { build: web.build, version: web.version, source: web.dir ? 'github' : 'local', checkedAt: web.checkedAt, error: web.error },
      tailscale: tsState,
      push: { publicKey: state.vapid.publicKey, dryRun: cfg.dryRun },
    })
  }
  if (req.method !== 'POST') return send(res, 405, { error: 'POST required' })
  let body
  try {
    body = JSON.parse((await readBody(req)).toString('utf8') || '{}')
  } catch {
    return send(res, 400, { error: 'invalid JSON' })
  }
  const gid = body.group
  if (!isId(gid)) return send(res, 400, { error: 'invalid group' })
  switch (path) {
    case '/push/subscribe': {
      const sub = body.subscription
      if (!isId(body.device) || !sub || typeof sub.endpoint !== 'string' || !/^https:\/\//.test(sub.endpoint) || !sub.keys?.p256dh || !sub.keys?.auth)
        return send(res, 400, { error: 'invalid subscription' })
      group(gid).subs[body.device] = { subscription: { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }, label: str(body.label, 60), addedAt: Date.now() }
      save()
      return send(res, 200, { ok: true, devices: Object.keys(group(gid).subs).length })
    }
    case '/push/unsubscribe': {
      if (state.groups[gid]) delete state.groups[gid].subs[body.device]
      save()
      return send(res, 200, { ok: true })
    }
    case '/push/plan': {
      const g = group(gid)
      const sent = new Map(g.items.filter((i) => i.sent).map((i) => [i.id, i.sent]))
      g.items = cleanItems(body.items).map((i) => (sent.has(i.id) ? { ...i, sent: sent.get(i.id) } : i))
      g.planFrom = str(body.device, 128)
      g.planAt = Date.now()
      save()
      return send(res, 200, { ok: true, scheduled: g.items.filter((i) => !i.sent).length })
    }
    case '/push/test': {
      const n = await deliver(gid, { id: `test-${Date.now()}`, title: str(body.title, 120) || 'Momentum', body: str(body.body, 400) || 'Push funktioniert!', tag: 'test', url: './' }, body.device)
      return send(res, 200, { ok: true, delivered: n })
    }
    case '/push/status': {
      const g = state.groups[gid]
      return send(res, 200, {
        devices: g ? Object.entries(g.subs).map(([id, s]) => ({ id, label: s.label })) : [],
        upcoming: g ? g.items.filter((i) => !i.sent).slice(0, 20) : [],
        sentLog: g?.sentLog ?? [],
      })
    }
    default:
      return send(res, 404, { error: 'unknown endpoint' })
  }
}

async function serveStatic(req, res, urlPath) {
  const root = webRoot()
  let rel = decodeURIComponent(urlPath)
  if (rel.endsWith('/')) rel += 'index.html'
  const file = normalize(join(root, rel))
  if (!file.startsWith(root)) return send(res, 403, 'forbidden')
  let target = file
  try {
    if (!(await stat(target)).isFile()) throw new Error('dir')
  } catch {
    if (extname(rel)) return send(res, 404, 'not found')
    target = join(root, 'index.html') // SPA fallback
  }
  try {
    const data = await readFile(target)
    const name = target.slice(root.length).replace(/\\/g, '/')
    const cache = name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream', 'cache-control': cache, 'x-content-type-options': 'nosniff' })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch {
    send(res, 503, 'Momentum wird gerade geladen (erste App-Version von GitHub). Bitte in einer Minute neu laden.')
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || '/'
  const q = url.indexOf('?')
  let path = q >= 0 ? url.slice(0, q) : url
  try {
    // the app lives under /momentum (Tailscale may or may not strip that prefix before forwarding)
    if (path === MOUNT && req.method === 'GET') return send(res, 301, '', { location: `${MOUNT}/${q >= 0 ? url.slice(q) : ''}` })
    let mounted = false
    while (path === MOUNT || path.startsWith(`${MOUNT}/`)) {
      path = path.slice(MOUNT.length) || '/'
      mounted = true
    }
    if (cfg.rootProxy && !mounted) return await proxyBridge(req, res, url) // tests: Bridge at the root
    if (path === '/bridge' || path.startsWith('/bridge/')) return await proxyBridge(req, res, path.slice('/bridge'.length) + (q >= 0 ? url.slice(q) : '') || '/')
    if (path.startsWith('/momentum-host/')) return await handleApi(req, res, path.slice('/momentum-host'.length))
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
    return await serveStatic(req, res, path)
  } catch (e) {
    send(res, e.status || 500, { error: e.message })
  }
})

await loadState()
await loadWebState()
setInterval(() => tick().catch((e) => log('tick failed', e.message)), 15_000)
server.listen(cfg.port, cfg.bind, () => {
  log(`Momentum-Host ${VERSION} läuft auf http://${cfg.bind}:${cfg.port}`)
  log(`Bridge: ${cfg.bridge}`)
  if (/\.ts\.net/.test(cfg.bridge)) log(`Momentum im Browser (PC + Handy): ${cfg.bridge}${MOUNT}/`)
  log(`App-Dateien: ${web.dir ? `GitHub-Version ${web.version || web.build}` : cfg.dist}`)
  if (cfg.dryRun) log('Push im Testmodus (dry-run)')
  void ensureTailscale()
  void checkWebUpdate()
  setInterval(() => void checkWebUpdate(), cfg.updateEvery)
  setInterval(() => void ensureTailscale(), 5 * 60 * 1000)
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => saveNow().finally(() => process.exit(0)))
