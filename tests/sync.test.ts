import { describe, expect, it } from 'vitest'
import * as actions from '../src/data/actions'
import { applyImport, buildExport, parseImport, ImportError } from '../src/data/exportImport'
import { LocalRepository } from '../src/data/repository'
import { DEFAULT_SETTINGS } from '../src/data/defaults'
import { buildIndex, occurrencesOn } from '../src/domain/occurrences'
import type { DataSnapshot } from '../src/domain/occurrences'
import { HybridClock, compareVersions, parseHlc, uuidv7 } from '../src/sync/clock'
import { BridgeSyncAdapter } from '../src/sync/BridgeSyncAdapter'
import { SyncService } from '../src/sync/SyncService'
import type { PullResult, SyncRecord, SyncTransport } from '../src/sync/types'
import type { Activity, UserSettings } from '../src/domain/types'

let dbCounter = 0
const openRepo = () => LocalRepository.open(`test-${Date.now()}-${++dbCounter}`)

async function snapshot(repo: LocalRepository): Promise<DataSnapshot> {
  const db = repo.db
  const settings = (await db.settings.get('settings')) as UserSettings | undefined
  return {
    activities: await db.activities.toArray(),
    categories: await db.categories.toArray(),
    entries: await db.entries.toArray(),
    overrides: await db.overrides.toArray(),
    challenges: await db.challenges.toArray(),
    settings: settings ?? DEFAULT_SETTINGS,
  }
}

const draft = (name: string): actions.ActivityDraft => ({
  name,
  description: '',
  icon: 'i:languages',
  color: 'pink',
  categoryId: null,
  kind: 'duration',
  unit: 'min',
  startDate: '2026-01-05',
  endDate: null,
  rule: { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] },
  target: 15,
  time: null,
  durationMinutes: null,
  reminderTime: null,
  partialCounts: false,
  notes: '',
})

/** In-memory stand-in for a sync server – used only to verify the local merge contract. */
class MemoryServer {
  log: SyncRecord[] = []
  store = new Map<string, SyncRecord>()
  transport(failAfterPushes = Infinity): SyncTransport {
    let pushes = 0
    return {
      id: 'memory',
      label: 'Memory',
      isAvailable: async () => true,
      push: async (records) => {
        if (pushes++ >= failAfterPushes) throw new Error('network down')
        for (const r of records) {
          const key = `${r.table}/${r.record.id}`
          const cur = this.store.get(key)
          if (!cur || compareVersions(r.record.version, cur.record.version) > 0) {
            this.store.set(key, r)
            this.log.push(r)
          }
        }
      },
      pull: async (cursor): Promise<PullResult> => {
        const from = cursor ? Number(cursor) : 0
        const page = this.log.slice(from, from + 50)
        return { records: page, cursor: String(from + page.length), hasMore: from + page.length < this.log.length }
      },
    }
  }
}

describe('clock and ids', () => {
  it('produces monotonic, comparable HLC versions', () => {
    let t = 1000
    const c = new HybridClock('dev1', () => t)
    const a = c.tick()
    const b = c.tick()
    t = 900 // clock moves backwards
    const d = c.tick()
    expect(compareVersions(a, b)).toBe(-1)
    expect(compareVersions(b, d)).toBe(-1)
    c.receive('000000000005000:0000:dev2')
    expect(parseHlc(c.tick())!.ms).toBe(5000)
  })
  it('creates RFC-style UUIDv7', () => {
    expect(uuidv7()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })
})

describe('local repository', () => {
  it('stamps metadata, keeps tombstones and compacts the outbox', async () => {
    const repo = await openRepo()
    actions.setRepository(repo)
    const a = await actions.createActivity(draft('Japanisch'))
    expect(a.version).toBeTruthy()
    expect(a.deletedAt).toBeNull()
    await repo.patch<Activity>('activities', a.id, { name: 'Japanisch 日本語' })
    await repo.patch<Activity>('activities', a.id, { color: 'blue' })
    expect(await repo.db.changes.count()).toBe(1)
    await actions.deleteActivity(a)
    const stored = await repo.db.activities.get(a.id)
    expect(stored!.deletedAt).not.toBeNull()
    expect(buildIndex(await snapshot(repo)).activities).toHaveLength(0)
  })

  it('logs progress with deterministic ids and refuses future dates', async () => {
    const repo = await openRepo()
    actions.setRepository(repo)
    const a = await actions.createActivity(draft('Lesen'))
    let idx = buildIndex(await snapshot(repo))
    const occ = occurrencesOn(idx, '2026-01-05')[0]
    await actions.logProgress(occ, 10, '2026-01-06')
    idx = buildIndex(await snapshot(repo))
    const e = idx.entries.get(`${a.id}_2026-01-05`)!
    expect(e.id).toBe(`e_${a.id}_2026-01-05`)
    expect(e.value).toBe(10)
    expect(e.target).toBe(15)
    const future = occurrencesOn(idx, '2026-01-07')[0]
    await expect(actions.logProgress(future, 15, '2026-01-06')).rejects.toBeInstanceOf(actions.FutureLogError)
    // undo -> tombstone
    await actions.logProgress(occurrencesOn(idx, '2026-01-05')[0], 0, '2026-01-06')
    idx = buildIndex(await snapshot(repo))
    expect(idx.entries.size).toBe(0)
  })
})

describe('sync service (with an in-memory transport)', () => {
  it('replicates activities, progress and deletions between two devices', async () => {
    const server = new MemoryServer()
    const phone = await openRepo()
    const laptop = await openRepo()
    const phoneSync = new SyncService(phone, server.transport())
    const laptopSync = new SyncService(laptop, server.transport())

    actions.setRepository(phone)
    const a = await actions.createActivity(draft('Gym'))
    const occ = occurrencesOn(buildIndex(await snapshot(phone)), '2026-01-05')[0]
    await actions.logProgress(occ, 15, '2026-01-05')
    await phoneSync.sync()
    await laptopSync.sync()

    let lap = buildIndex(await snapshot(laptop))
    expect(lap.activityById.get(a.id)!.name).toBe('Gym')
    expect(lap.entries.get(`${a.id}_2026-01-05`)!.value).toBe(15)

    // concurrent edits: the later one wins on both devices
    actions.setRepository(laptop)
    await laptop.patch<Activity>('activities', a.id, { name: 'Gym (laptop)' })
    await new Promise((r) => setTimeout(r, 5))
    actions.setRepository(phone)
    await phone.patch<Activity>('activities', a.id, { name: 'Gym (phone)' })
    await laptopSync.sync()
    await phoneSync.sync()
    await laptopSync.sync()
    lap = buildIndex(await snapshot(laptop))
    const ph = buildIndex(await snapshot(phone))
    expect(lap.activityById.get(a.id)!.name).toBe('Gym (phone)')
    expect(ph.activityById.get(a.id)!.name).toBe('Gym (phone)')

    // deletion propagates as tombstone and is not resurrected
    await actions.deleteActivity(ph.activityById.get(a.id)!)
    await phoneSync.sync()
    await laptopSync.sync()
    expect(buildIndex(await snapshot(laptop)).activities).toHaveLength(0)
  })

  it('resumes an interrupted push without losing changes', async () => {
    const server = new MemoryServer()
    const repo = await openRepo()
    actions.setRepository(repo)
    for (let i = 0; i < 3; i++) await actions.createActivity(draft(`A${i}`))
    const flaky = new SyncService(repo, server.transport(0))
    await expect(flaky.sync()).rejects.toThrow('network down')
    expect((await flaky.getState()).status).toBe('error')
    const ok = new SyncService(repo, server.transport())
    // same transport id -> same persisted state
    await ok.sync()
    expect(server.store.size).toBe(3)
    expect((await ok.getState()).status).toBe('idle')
  })

  it('the Bridge adapter is honest about not being connected', async () => {
    const repo = await openRepo()
    const svc = new SyncService(repo, new BridgeSyncAdapter())
    const report = await svc.sync()
    expect(report.pushed).toBe(0)
    expect((await svc.getState()).status).toBe('disabled')
  })
})

describe('export / import', () => {
  it('round-trips data, validates input and supports merge and replace', async () => {
    const source = await openRepo()
    actions.setRepository(source)
    const a = await actions.createActivity(draft('Japanisch'))
    const occ = occurrencesOn(buildIndex(await snapshot(source)), '2026-01-05')[0]
    await actions.logProgress(occ, 20, '2026-01-05', 'Kana geübt')
    const json = await buildExport()

    expect(() => parseImport('not json')).toThrow(ImportError)
    expect(() => parseImport('{"format":"other"}')).toThrow(ImportError)
    const broken = JSON.parse(json)
    broken.data.entries.push({ id: 'x', date: '2026-02-31' })
    const parsed = parseImport(JSON.stringify(broken))
    expect(parsed.invalid).toBe(1)
    expect(parsed.counts.activities).toBe(1)

    const target = await openRepo()
    actions.setRepository(target)
    const local = await actions.createActivity(draft('Lokal'))
    await applyImport(parsed, 'merge')
    let idx = buildIndex(await snapshot(target))
    expect(idx.activities.map((x) => x.name).sort()).toEqual(['Japanisch', 'Lokal'])
    expect(idx.entries.get(`${a.id}_2026-01-05`)!.note).toBe('Kana geübt')

    await applyImport(parsed, 'replace')
    idx = buildIndex(await snapshot(target))
    expect(idx.activities.map((x) => x.name)).toEqual(['Japanisch'])
    expect((await target.db.activities.get(local.id))!.deletedAt).not.toBeNull()
  })
})
