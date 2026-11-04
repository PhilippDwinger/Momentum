import { SYNCED_TABLES, type SyncedTable, type SyncMeta } from '../../domain/types'
import type { SyncConflict } from '../../data/db'
import { builtinCategoryRecords } from '../../data/defaults'
import type { LocalRepository } from '../../data/repository'
import { compareVersions, parseHlc, randomDeviceId } from '../clock'
import type { ChangeLogEntry, SyncRecordData } from '../types'
import { BridgeApi, BridgeError, type FetchLike, type PolledMessage } from './api'
import { deriveGroupKeys, envelopeSize, normalizeSyncId, seal, unseal, type GroupKeys } from './crypto'

/**
 * Device-to-device sync over Bridge. Bridge only transports messages – it stores nothing
 * permanently and makes no sync decisions. Every device keeps the full data set.
 *
 *  - Discovery: all devices of a Sync-ID subscribe to one topic in Bridge's public realm and
 *    announce themselves there (`hello`). Peers answer with a direct `welcome`.
 *  - Data: each device sends its outbox (the compacted change log, incl. changes it learned from
 *    others) to every peer as direct messages (`changes`, lifetime 7 days, so offline devices get
 *    them later). Peers confirm with `ack`; the per-peer cursor makes interrupted syncs resume.
 *  - Merge: last-writer-wins on the HLC version. Concurrent edits of the same record with
 *    different content become conflicts the user decides (or "newest wins" if configured).
 *  - First contact while both sides already have data: the user chooses merge / take the
 *    group's data / give this device's data to the group.
 *  - Everything is encrypted with a key derived from the Sync-ID (see crypto.ts).
 */

export interface DataSummary {
  activities: number
  entries: number
  total: number
}

export interface PeerInfo {
  id: string
  ip: string
  name: string
  lastSeen: number
  /** Highest seq of OUR outbox the peer confirmed. */
  ackSeq: number
  /** Highest seq we sent and that is still waiting for an ack. */
  sentTo: number
  sentAt: number
  /** First full exchange still running – concurrent-edit detection is off. */
  initial: boolean
  /** "Give my data to the group": records of this peer we don't have become tombstones. */
  align: 'mine' | null
  gotLast: boolean
  /** Last failed delivery (recipient unknown / mailbox full) – back off for a while. */
  failAt?: number
  /** When the peer joined the group. */
  since?: number
}

export type InitialChoice = 'merge' | 'theirs' | 'mine'
export type ConflictPolicy = 'ask' | 'newest'

export interface PersistedSyncState {
  enabled: boolean
  syncId: string
  deviceId: string
  deviceName: string
  account: { clientIp: string; password: string; secret: string; server: string } | null
  peers: Record<string, PeerInfo>
  initialChoiceDone: boolean
  pendingChoice: { peerId: string; peerName: string; theirs: DataSummary; mine: DataSummary } | null
  conflictPolicy: ConflictPolicy
  lastSyncAt: number | null
  lastError: string | null
  /** When this device joined the group – the newer device asks on first contact. */
  joinedAt: number
}

export type RuntimeStatus = 'off' | 'connecting' | 'online' | 'offline' | 'error' | 'choice'

export interface SyncSnapshot {
  state: PersistedSyncState
  status: RuntimeStatus
  conflicts: number
  pending: number
}

interface Msg {
  t: 'hello' | 'welcome' | 'changes' | 'ack' | 'resync'
  dev: string
  name?: string
  since?: number
  sum?: DataSummary
  peers?: { dev: string; ip: string; name: string }[]
  from?: number
  to?: number
  last?: boolean
  upTo?: number
  recs?: [SyncedTable, SyncRecordData, 0 | 1][]
}

const META_KEY = 'bridgeSync'
const MAX_ENVELOPE = 56 * 1024
const DIRECT_LIFETIME = 7 * 24 * 3600
const HELLO_EVERY = 10 * 60 * 1000
const PEER_FORGET = 60 * 24 * 3600 * 1000

export interface EngineOptions {
  baseUrl: string
  fetch?: FetchLike
  now?: () => number
  /** Long-poll seconds in the background loop. */
  pollWait?: number
  /** Device id used to identify this device among peers (default: repository device id). */
  deviceId?: string
  /** Start the background loop automatically after configure() (default true). */
  autoStart?: boolean
}

const META_FIELDS = new Set(['createdAt', 'updatedAt', 'version', 'loggedAt'])

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => !META_FIELDS.has(k))
      .sort()
      .map((k) => `${JSON.stringify(k)}:${k === 'deletedAt' ? (v as Record<string, unknown>)[k] !== null : stable((v as Record<string, unknown>)[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export function sameContent(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b)
}

export class BridgeSync {
  readonly repo: LocalRepository
  readonly api: BridgeApi
  private readonly now: () => number
  private readonly pollWait: number
  private s!: PersistedSyncState
  private status: RuntimeStatus = 'off'
  private keys: GroupKeys | null = null
  private session: { token: string; realm: string; at: number } | null = null
  private lastHelloAt = 0
  private running = false
  private loopPromise: Promise<void> | null = null
  private sending: Promise<void> | null = null
  private sendAgain = false
  private listeners = new Set<() => void>()
  private snapshot: SyncSnapshot | null = null
  private conflictCount = 0
  private pendingCount = 0
  private debounce: ReturnType<typeof setTimeout> | null = null
  private wake: (() => void) | null = null

  constructor(repo: LocalRepository, opts: EngineOptions) {
    this.repo = repo
    this.api = new BridgeApi(opts.baseUrl, opts.fetch)
    this.now = opts.now ?? Date.now
    this.pollWait = opts.pollWait ?? 20
    this.deviceIdOverride = opts.deviceId
    this.autoStart = opts.autoStart ?? true
    repo.onLocalChange(() => this.localChanged())
  }
  private deviceIdOverride?: string
  private autoStart: boolean

  // ------------------------------------------------------------------ state

  async load(): Promise<void> {
    const row = (await this.repo.db.meta.get(META_KEY))?.value as PersistedSyncState | undefined
    this.s = {
      enabled: false,
      syncId: '',
      deviceId: this.deviceIdOverride ?? this.repo.deviceId,
      deviceName: '',
      account: null,
      peers: {},
      initialChoiceDone: false,
      pendingChoice: null,
      conflictPolicy: 'ask',
      lastSyncAt: null,
      lastError: null,
      joinedAt: 0,
      ...row,
    }
    // a different Bridge server (e.g. changed in the app settings) needs a new account there
    if (this.s.account && this.s.account.server !== this.api.base) {
      this.s.account = null
      await this.repo.db.meta.put({ key: META_KEY, value: this.s })
    }
    if (this.s.enabled && this.s.syncId) this.keys = await deriveGroupKeys(this.s.syncId)
    this.status = this.s.enabled ? (this.s.pendingChoice ? 'choice' : 'connecting') : 'off'
    await this.refreshCounts()
  }

  private async persist() {
    await this.repo.db.meta.put({ key: META_KEY, value: this.s })
    await this.refreshCounts()
  }

  private async refreshCounts() {
    this.conflictCount = await this.repo.db.conflicts.count()
    this.pendingCount = await this.pendingForPeers()
    this.emit()
  }

  private async pendingForPeers(): Promise<number> {
    const peers = this.activePeers()
    if (peers.length === 0) return 0
    const min = Math.min(...peers.map((p) => p.ackSeq))
    return this.repo.db.changes.where('seq').above(min).count()
  }

  private emit() {
    this.snapshot = null
    for (const l of this.listeners) l()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot(): SyncSnapshot {
    if (!this.snapshot) this.snapshot = { state: this.s, status: this.status, conflicts: this.conflictCount, pending: this.pendingCount }
    return this.snapshot
  }

  get groupId(): string | null {
    return this.keys?.groupId ?? null
  }

  private setStatus(st: RuntimeStatus, error?: string | null) {
    this.status = this.s.pendingChoice ? 'choice' : st
    if (error !== undefined) this.s.lastError = error
    this.emit()
  }

  private activePeers(): PeerInfo[] {
    const cutoff = this.now() - PEER_FORGET
    return Object.values(this.s.peers).filter((p) => p.id !== this.s.deviceId && (p.lastSeen === 0 || p.lastSeen > cutoff))
  }

  // ------------------------------------------------------------------ public API

  /** Joins (or switches to) a sync group. Data exchange starts on the next cycle. */
  async configure(syncId: string, deviceName: string): Promise<void> {
    const id = normalizeSyncId(syncId)
    if (id.length < 4) throw new Error('Sync-ID zu kurz')
    const changed = id !== this.s.syncId
    this.s.syncId = id
    this.s.deviceName = deviceName.trim().slice(0, 40) || 'Gerät'
    this.s.enabled = true
    if (changed) {
      this.s.peers = {}
      this.s.initialChoiceDone = false
      this.s.pendingChoice = null
      this.session = null
      this.lastHelloAt = 0
      this.s.joinedAt = this.now()
      await this.repo.db.conflicts.clear()
    }
    this.keys = await deriveGroupKeys(id)
    await this.persist()
    this.setStatus('connecting', null)
    if (this.autoStart) this.start()
  }

  async disable(): Promise<void> {
    this.s.enabled = false
    this.session = null
    await this.persist()
    this.stop()
    this.setStatus('off', null)
  }

  async setDeviceName(name: string) {
    this.s.deviceName = name.trim().slice(0, 40) || 'Gerät'
    this.lastHelloAt = 0
    await this.persist()
  }

  async setConflictPolicy(p: ConflictPolicy) {
    this.s.conflictPolicy = p
    await this.persist()
  }

  start() {
    if (this.running || !this.s.enabled) return
    this.running = true
    this.loopPromise = this.loop()
  }

  stop() {
    this.running = false
    this.wake?.()
  }

  /** Runs one full cycle without long-polling (used by "Jetzt synchronisieren" and tests). */
  async syncNow(): Promise<void> {
    await this.cycle(0)
  }

  // ------------------------------------------------------------------ loop

  private async loop() {
    let backoff = 2000
    while (this.running && this.s.enabled) {
      try {
        await this.cycle(this.pollWait)
        backoff = 2000
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (e instanceof BridgeError && (e.code === 'SESSION_INVALID' || e.code === 'INVALID_CREDENTIALS' || e.code === 'CLIENT_NOT_FOUND')) this.session = null
        this.setStatus(e instanceof BridgeError && e.status === 0 ? 'offline' : 'error', msg)
        await new Promise<void>((r) => {
          const t = setTimeout(r, backoff)
          this.wake = () => {
            clearTimeout(t)
            r()
          }
        })
        backoff = Math.min(60_000, backoff * 2)
      }
    }
    this.loopPromise = null
  }

  private async cycle(wait: number) {
    if (!this.s.enabled || !this.keys) return
    await this.ensureSession()
    if (this.now() - this.lastHelloAt > HELLO_EVERY) {
      await this.publish({ t: 'hello', dev: this.s.deviceId, name: this.s.deviceName, since: this.s.joinedAt, sum: await this.summary() })
      this.lastHelloAt = this.now()
    }
    await this.sendPending()
    const messages = await this.withSession((tk) => this.api.poll(tk, wait))
    for (const m of messages) await this.handle(m)
    await this.sendPending()
    this.s.lastSyncAt = this.now()
    await this.persist()
    this.setStatus('online', null)
  }

  private localChanged() {
    if (!this.s?.enabled) return
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => {
      this.sendPending().catch(() => {})
      this.refreshCounts().catch(() => {})
    }, 1200)
  }

  // ------------------------------------------------------------------ session

  private async ensureSession(): Promise<string> {
    if (this.session && this.now() - this.session.at < 50 * 60 * 1000) return this.session.token
    this.setStatus('connecting')
    if (!this.s.account) {
      const password = randomDeviceId() + randomDeviceId() + randomDeviceId()
      const secret = Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('')
      const r = await this.api.register(`momentum-${this.s.deviceName || 'device'}`.slice(0, 60), password, secret)
      this.s.account = { clientIp: r.client_ip, password, secret, server: this.api.base }
      await this.persist()
    }
    let login
    try {
      login = await this.api.login(this.s.account.clientIp, this.s.account.password)
    } catch (e) {
      if (!(e instanceof BridgeError) || e.code !== 'INVALID_CREDENTIALS') throw e
      // Bridge restarted without backup: register again – same secret gives the same IP
      const acc = this.s.account
      try {
        const r = await this.api.register(`momentum-${this.s.deviceName || 'device'}`.slice(0, 60), acc.password, acc.secret)
        acc.clientIp = r.client_ip
      } catch (e2) {
        if (!(e2 instanceof BridgeError) || e2.code !== 'ALREADY_EXISTS') throw e2
        this.s.account = null // identity taken by an account we cannot log into – start fresh
        await this.persist()
        return this.ensureSession()
      }
      await this.persist()
      login = await this.api.login(acc.clientIp, acc.password)
    }
    const realm = (await this.api.publicRealm()).realm_address
    await this.api.join(login.session_token, realm).catch((e) => {
      if (!(e instanceof BridgeError) || e.status >= 500) throw e
    })
    await this.api.subscribe(login.session_token, realm, this.keys!.topic)
    this.session = { token: login.session_token, realm, at: this.now() }
    this.lastHelloAt = 0
    return login.session_token
  }

  private async withSession<T>(fn: (token: string) => Promise<T>): Promise<T> {
    const token = await this.ensureSession()
    try {
      return await fn(token)
    } catch (e) {
      if (e instanceof BridgeError && e.code === 'SESSION_INVALID') {
        this.session = null
        return fn(await this.ensureSession())
      }
      throw e
    }
  }

  // ------------------------------------------------------------------ transport

  private async publish(msg: Msg) {
    const env = await seal(this.keys!.key, msg)
    await this.withSession((tk) => this.api.publish(tk, this.session!.realm, this.keys!.topic, env))
  }

  private async direct(peer: PeerInfo, msg: Msg, lifetime = DIRECT_LIFETIME): Promise<boolean> {
    const env = await seal(this.keys!.key, msg)
    try {
      await this.withSession((tk) => this.api.send(tk, peer.ip, env, lifetime))
      return true
    } catch (e) {
      if (e instanceof BridgeError && (e.code === 'RECIPIENT_NOT_FOUND' || e.code === 'MAILBOX_FULL' || e.code === 'RECIPIENT_REJECTED')) return false
      throw e
    }
  }

  // ------------------------------------------------------------------ receiving

  private upsertPeer(id: string, ip: string, name: string | undefined, seen: boolean): PeerInfo {
    const p = this.s.peers[id] ?? { id, ip, name: name ?? '', lastSeen: 0, ackSeq: 0, sentTo: 0, sentAt: 0, initial: true, align: null, gotLast: false }
    if (ip) p.ip = ip
    if (name) p.name = name
    if (seen) {
      p.lastSeen = this.now()
      p.failAt = 0
    }
    this.s.peers[id] = p
    return p
  }

  private async handle(m: PolledMessage) {
    const content = m.content as { data?: unknown } | undefined
    const raw = m.message.content_type === 'event' ? content?.data : m.content
    const msg = (await unseal(this.keys!.key, raw)) as Msg | null
    if (!msg || typeof msg.dev !== 'string' || msg.dev === this.s.deviceId) return
    const ip = m.message.sender_ip
    const firstContact = !this.s.peers[msg.dev]
    const peer = this.upsertPeer(msg.dev, ip, msg.name, true)
    if (typeof msg.since === 'number') peer.since = msg.since

    switch (msg.t) {
      case 'hello':
        await this.direct(peer, { t: 'welcome', dev: this.s.deviceId, name: this.s.deviceName, since: this.s.joinedAt, sum: await this.summary(), peers: this.peerList() }, 24 * 3600)
        if (firstContact || !this.s.initialChoiceDone) await this.checkInitial(peer, msg.sum)
        break
      case 'welcome':
        for (const p of msg.peers ?? []) if (p.dev !== this.s.deviceId && p.ip) this.upsertPeer(p.dev, this.s.peers[p.dev]?.ip || p.ip, p.name, false)
        if (firstContact || !this.s.initialChoiceDone) await this.checkInitial(peer, msg.sum)
        break
      case 'ack':
        if (typeof msg.upTo === 'number') {
          peer.ackSeq = Math.max(peer.ackSeq, msg.upTo)
          if (peer.ackSeq >= peer.sentTo) peer.sentAt = 0
        }
        break
      case 'resync':
        peer.ackSeq = typeof msg.from === 'number' ? Math.min(peer.ackSeq, msg.from) : peer.ackSeq
        peer.sentTo = peer.ackSeq
        peer.sentAt = 0
        if (typeof msg.from === 'number' && msg.from === 0) peer.initial = true
        break
      case 'changes':
        if (this.s.pendingChoice || !this.s.initialChoiceDone) {
          if (!this.s.initialChoiceDone && !this.s.pendingChoice) await this.checkInitial(peer, msg.sum)
          if (this.s.pendingChoice) break // decide first – the peer resends later
        }
        await this.applyChanges(peer, msg)
        await this.direct(peer, { t: 'ack', dev: this.s.deviceId, upTo: msg.to ?? 0 })
        break
    }
    await this.persist()
  }

  private peerList() {
    return Object.values(this.s.peers).map((p) => ({ dev: p.id, ip: p.ip, name: p.name }))
  }

  private async checkInitial(peer: PeerInfo, theirs?: DataSummary) {
    if (this.s.initialChoiceDone || this.s.pendingChoice) return
    const mine = await this.summary()
    const peerOlder = (peer.since ?? 0) < this.s.joinedAt || ((peer.since ?? 0) === this.s.joinedAt && peer.id < this.s.deviceId)
    if (!theirs || theirs.total === 0 || mine.total === 0 || !peerOlder) {
      // nothing to decide – or we are the older member and act as "the group"; the newer device asks
      this.s.initialChoiceDone = true
      for (const p of Object.values(this.s.peers)) p.initial = true
      return
    }
    this.s.pendingChoice = { peerId: peer.id, peerName: peer.name, theirs, mine }
    this.setStatus('choice')
  }

  async resolveInitial(choice: InitialChoice): Promise<void> {
    if (!this.s.pendingChoice) return
    const db = this.repo.db
    if (choice === 'theirs') {
      // this device takes the group's data: wipe local data (no tombstones – they would delete the group's records)
      await db.transaction('rw', [...SYNCED_TABLES.map((t) => db.table(t)), db.changes, db.conflicts, db.meta], async () => {
        for (const t of SYNCED_TABLES) await db.table(t).clear()
        await db.changes.clear()
        await db.conflicts.clear()
        await db.categories.bulkPut(builtinCategoryRecords().map((c) => ({ ...c, createdAt: 0, updatedAt: 0, version: '000000000000000:0000:seed', deletedAt: null })))
      })
      for (const p of Object.values(this.s.peers)) Object.assign(p, { ackSeq: 0, sentTo: 0, sentAt: 0, initial: true, align: null, gotLast: false })
    } else if (choice === 'mine') {
      // this device's data wins: re-stamp everything so it is newer than any copy in the group,
      // and turn records of the group that we don't have into tombstones when they arrive
      for (const t of SYNCED_TABLES) {
        const live = (await db.table(t).toArray()).filter((r) => !r.deletedAt && r.version !== '000000000000000:0000:seed')
        if (live.length) await this.repo.putMany(t, live)
      }
      for (const p of Object.values(this.s.peers)) Object.assign(p, { initial: true, align: 'mine', gotLast: false })
    } else {
      for (const p of Object.values(this.s.peers)) Object.assign(p, { initial: true, gotLast: false })
    }
    this.s.pendingChoice = null
    this.s.initialChoiceDone = true
    await this.persist()
    // ask everybody to send their full history (from 0) again
    for (const p of this.activePeers()) await this.direct(p, { t: 'resync', dev: this.s.deviceId, from: 0 }).catch(() => false)
    this.setStatus('connecting')
    await this.sendPending().catch(() => {})
  }

  private async applyChanges(peer: PeerInfo, msg: Msg) {
    const db = this.repo.db
    const recs = Array.isArray(msg.recs) ? msg.recs : []
    const tables = SYNCED_TABLES.map((t) => db.table(t))
    const tombstones: [SyncedTable, SyncRecordData][] = []
    await db.transaction('rw', [...tables, db.changes, db.meta, db.conflicts], async () => {
      for (const item of recs) {
        if (!Array.isArray(item)) continue
        const [table, rec, authored] = item
        if (!(SYNCED_TABLES as readonly string[]).includes(table) || !rec || typeof rec.id !== 'string' || !parseHlc(String(rec.version))) continue
        this.repo.clock.receive(rec.version)
        const tbl = db.table(table)
        const local = (await tbl.get(rec.id)) as SyncRecordData | undefined
        if (peer.align === 'mine') {
          if (!local && !rec.deletedAt) tombstones.push([table, rec])
          continue
        }
        if (local && local.version === rec.version) continue
        if (local && sameContent(local, rec)) {
          if (compareVersions(rec.version, local.version) > 0) await this.store(table, rec)
          continue
        }
        if (local) {
          const entry = await db.changes.where('[table+id]').equals([table, rec.id]).first()
          const concurrent = !peer.initial && authored === 1 && entry && entry.origin !== 'remote' && (entry.seq ?? 0) > peer.ackSeq
          if (concurrent && this.s.conflictPolicy === 'ask' && local.version !== '000000000000000:0000:seed') {
            const conflict: SyncConflict = { id: `${table}:${rec.id}`, table, local, remote: rec, peerName: peer.name, at: this.now() }
            await db.conflicts.put(conflict)
            continue
          }
          if (compareVersions(rec.version, local.version) <= 0) continue
        }
        await this.store(table, rec)
      }
    })
    for (const [table, rec] of tombstones) {
      const { createdAt: _c, updatedAt: _u, version: _v, ...rest } = rec
      await this.repo.put(table, { ...rest, deletedAt: this.now() } as SyncRecordData)
    }
    if (msg.last) {
      peer.gotLast = true
      if (peer.align === 'mine') peer.align = null
    }
  }

  private async store(table: SyncedTable, rec: SyncRecordData) {
    const db = this.repo.db
    await db.table(table).put(rec)
    const prev = await db.changes.where('[table+id]').equals([table, rec.id]).first()
    if (prev?.seq !== undefined) await db.changes.delete(prev.seq)
    const entry: ChangeLogEntry = { table, id: rec.id, version: rec.version, at: this.now(), origin: 'remote' }
    await db.changes.add(entry)
    await db.conflicts.delete(`${table}:${rec.id}`)
  }

  // ------------------------------------------------------------------ sending

  async sendPending(): Promise<void> {
    if (!this.s.enabled || !this.keys || this.s.pendingChoice || !this.s.initialChoiceDone) return
    if (this.sending) {
      this.sendAgain = true
      return this.sending
    }
    this.sending = (async () => {
      do {
        this.sendAgain = false
        for (const peer of this.activePeers()) await this.sendTo(peer)
      } while (this.sendAgain)
    })().finally(() => {
      this.sending = null
    })
    await this.sending
    await this.persist()
  }

  private async sendTo(peer: PeerInfo) {
    const now = this.now()
    const recentlySeen = now - peer.lastSeen < 15 * 60 * 1000
    if (peer.sentTo > peer.ackSeq && now - peer.sentAt < (recentlySeen ? 60_000 : 6 * 3600 * 1000)) return
    if (peer.failAt && now - peer.failAt < 5 * 60 * 1000) return
    const db = this.repo.db
    const entries = await db.changes.where('seq').above(peer.ackSeq).limit(400).toArray()
    if (entries.length === 0) {
      if (peer.initial && peer.gotLast) peer.initial = false
      return
    }
    const maxSeq = (await db.changes.orderBy('seq').last())?.seq ?? 0
    const sum = await this.summary()
    let batch = entries
    for (;;) {
      const recs: [SyncedTable, SyncRecordData, 0 | 1][] = []
      for (const e of batch) {
        const rec = (await db.table(e.table).get(e.id)) as SyncRecordData | undefined
        if (rec) recs.push([e.table, rec, e.origin === 'remote' ? 0 : 1])
      }
      const to = batch[batch.length - 1].seq!
      const msg: Msg = { t: 'changes', dev: this.s.deviceId, name: this.s.deviceName, since: this.s.joinedAt, sum, from: peer.ackSeq, to, last: to >= maxSeq, recs }
      const env = await seal(this.keys!.key, msg)
      if (envelopeSize(env) > MAX_ENVELOPE && batch.length > 1) {
        batch = batch.slice(0, Math.ceil(batch.length / 2))
        continue
      }
      if (envelopeSize(env) > MAX_ENVELOPE) return // a single record above 56 KB – cannot be sent
      const ok = await this.direct(peer, msg)
      if (ok) {
        peer.sentTo = to
        peer.sentAt = now
        peer.failAt = 0
      } else peer.failAt = now
      return
    }
  }

  // ------------------------------------------------------------------ helpers

  async summary(): Promise<DataSummary> {
    const db = this.repo.db
    const activities = await db.activities.filter((r: SyncMeta) => !r.deletedAt).count()
    const entries = await db.entries.filter((r: SyncMeta) => !r.deletedAt).count()
    return { activities, entries, total: activities + entries }
  }

  async listConflicts(): Promise<SyncConflict[]> {
    return this.repo.db.conflicts.orderBy('at').toArray()
  }

  /** local = keep this device's version, remote = take the other one, combine = entries only. */
  async resolveConflict(id: string, choice: 'local' | 'remote' | 'combine'): Promise<void> {
    const c = await this.repo.db.conflicts.get(id)
    if (!c) return
    const strip = (r: Record<string, unknown>) => {
      const { createdAt: _c, updatedAt: _u, version: _v, ...rest } = r
      return rest as SyncRecordData
    }
    let winner: SyncRecordData
    if (choice === 'remote') winner = strip(c.remote)
    else if (choice === 'combine' && c.table === 'entries') {
      const l = c.local as Record<string, unknown>
      const r = c.remote as Record<string, unknown>
      const notes = [l.note, r.note].filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      winner = strip({ ...l, value: Math.max(Number(l.value) || 0, Number(r.value) || 0), note: Array.from(new Set(notes)).join(' · '), deletedAt: null })
    } else winner = strip(c.local)
    await this.repo.put(c.table, { ...winner, deletedAt: (winner.deletedAt as number | null) ?? null })
    await this.repo.db.conflicts.delete(id)
    await this.refreshCounts()
  }

  async resolveAll(choice: 'local' | 'remote' | 'newest'): Promise<void> {
    for (const c of await this.listConflicts()) {
      const pick = choice === 'newest' ? (compareVersions(String(c.remote.version), String(c.local.version)) > 0 ? 'remote' : 'local') : choice
      await this.resolveConflict(c.id, pick)
    }
  }

  /** Wait for the background loop to finish (tests). */
  async idle() {
    this.stop()
    await this.loopPromise
  }
}
