#!/usr/bin/env node
/**
 * Momentum-Host – runs on your PC next to Bridge (nothing in Bridge is changed).
 *
 *  1. serves the built app (dist/) – put it behind `tailscale serve` for HTTPS on the phone
 *  2. forwards /bridge/* 1:1 to the Bridge server. Bridge sends no CORS headers, so a browser
 *     can only talk to it through the same origin. The host does NOT sync anything itself –
 *     the devices talk to each other through Bridge.
 *  3. sends Web Push notifications. Devices upload their notification plan (texts are generated
 *     on the device), the host delivers each item at its time – also when the app is closed.
 *
 * Config via environment variables (defaults in brackets):
 *   MOMENTUM_PORT   [5180]           MOMENTUM_BIND [127.0.0.1]
 *   BRIDGE_URL      [https://muttchen.tail91b057.ts.net:8443]
 *   MOMENTUM_DIST   [<repo>/dist]    MOMENTUM_DATA [<repo>/host/data]
 *   MOMENTUM_PUSH_DRYRUN=1           log pushes instead of sending (tests)
 */
import { createServer } from 'node:http'
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, extname, normalize, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import webpush from 'web-push'

const here = dirname(fileURLToPath(import.meta.url))
const cfg = {
  port: Number(process.env.MOMENTUM_PORT || 5180),
  bind: process.env.MOMENTUM_BIND || '127.0.0.1',
  bridge: (process.env.BRIDGE_URL || 'https://muttchen.tail91b057.ts.net:8443').replace(/\/+$/, ''),
  dist: resolve(process.env.MOMENTUM_DIST || join(here, '..', 'dist')),
  data: resolve(process.env.MOMENTUM_DATA || join(here, 'data')),
  dryRun: process.env.MOMENTUM_PUSH_DRYRUN === '1',
}
const VERSION = '1.1.0'
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
    return send(res, 200, { app: 'momentum-host', version: VERSION, bridge: cfg.bridge, push: { publicKey: state.vapid.publicKey, dryRun: cfg.dryRun } })
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
  let rel = decodeURIComponent(urlPath.split('?')[0])
  if (rel.endsWith('/')) rel += 'index.html'
  const file = normalize(join(cfg.dist, rel))
  if (!file.startsWith(cfg.dist)) return send(res, 403, 'forbidden')
  let target = file
  try {
    if (!(await stat(target)).isFile()) throw new Error('dir')
  } catch {
    if (extname(rel)) return send(res, 404, 'not found')
    target = join(cfg.dist, 'index.html') // SPA fallback
  }
  try {
    const data = await readFile(target)
    const name = target.slice(cfg.dist.length).replace(/\\/g, '/')
    const cache = name.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache'
    res.writeHead(200, { 'content-type': MIME[extname(target)] || 'application/octet-stream', 'cache-control': cache, 'x-content-type-options': 'nosniff' })
    res.end(req.method === 'HEAD' ? undefined : data)
  } catch {
    send(res, 500, 'Die App ist noch nicht gebaut. Bitte zuerst "npm run build" ausführen.')
  }
}

const server = createServer(async (req, res) => {
  const url = req.url || '/'
  try {
    if (url === '/bridge' || url.startsWith('/bridge/')) return await proxyBridge(req, res, url.slice('/bridge'.length) || '/')
    if (url.startsWith('/momentum-host/')) return await handleApi(req, res, url.slice('/momentum-host'.length).split('?')[0])
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'method not allowed')
    return await serveStatic(req, res, url)
  } catch (e) {
    send(res, e.status || 500, { error: e.message })
  }
})

await loadState()
setInterval(() => tick().catch((e) => log('tick failed', e.message)), 15_000)
server.listen(cfg.port, cfg.bind, () => {
  log(`Momentum-Host ${VERSION} läuft auf http://${cfg.bind}:${cfg.port}`)
  log(`Bridge-Ziel: ${cfg.bridge}`)
  log(`App-Dateien: ${cfg.dist}${existsSync(join(cfg.dist, 'index.html')) ? '' : '  (fehlen – npm run build!)'}`)
  if (cfg.dryRun) log('Push im Testmodus (dry-run)')
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => saveNow().finally(() => process.exit(0)))
