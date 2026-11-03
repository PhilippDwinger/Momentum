import type { SyncMeta, SyncedTable } from '../domain/types'
import { HybridClock, randomDeviceId } from '../sync/clock'
import type { ChangeLogEntry } from '../sync/types'
import { MomentumDB } from './db'

type Stampable = Partial<SyncMeta> & { id: string }

/**
 * LocalRepository – the only place that writes synchronisable records.
 *
 * Every write, in one IndexedDB transaction:
 *  1. stamps `updatedAt`, `version` (HLC) and keeps `createdAt`
 *  2. stores the record (deletes are tombstones: `deletedAt` is set, the record stays)
 *  3. records the change in the compacted outbox (`changes`) for a future sync transport
 *
 * UI components never touch Dexie directly; they call the actions in `actions.ts`.
 */
export class LocalRepository {
  readonly db: MomentumDB
  readonly clock: HybridClock
  readonly deviceId: string

  constructor(db: MomentumDB, clock: HybridClock, deviceId: string) {
    this.db = db
    this.clock = clock
    this.deviceId = deviceId
  }

  static async open(name = 'momentum'): Promise<LocalRepository> {
    const db = new MomentumDB(name)
    await db.open()
    let deviceId = (await db.meta.get('deviceId'))?.value as string | undefined
    if (!deviceId) {
      deviceId = randomDeviceId()
      await db.meta.put({ key: 'deviceId', value: deviceId })
    }
    const clock = new HybridClock(deviceId)
    clock.receive((await db.meta.get('clock'))?.value as string | undefined)
    return new LocalRepository(db, clock, deviceId)
  }

  private stamp<T extends Stampable>(record: T, existing: Stampable | undefined, now: number): T & SyncMeta {
    return {
      ...record,
      createdAt: existing?.createdAt ?? record.createdAt ?? now,
      updatedAt: now,
      version: this.clock.tick(),
      deletedAt: record.deletedAt ?? null,
    } as T & SyncMeta
  }

  private async logChange(table: SyncedTable, id: string, version: string, at: number) {
    const prev = await this.db.changes.where('[table+id]').equals([table, id]).first()
    if (prev?.seq !== undefined) await this.db.changes.delete(prev.seq)
    const entry: ChangeLogEntry = { table, id, version, at }
    await this.db.changes.add(entry)
  }

  private async persistClock() {
    await this.db.meta.put({ key: 'clock', value: this.clock.current })
  }

  /** Insert or replace records (full objects). Returns the stamped records. */
  async putMany<T extends Stampable>(table: SyncedTable, records: T[]): Promise<(T & SyncMeta)[]> {
    if (records.length === 0) return []
    const tbl = this.db.table(table)
    return this.db.transaction('rw', [tbl, this.db.changes, this.db.meta], async () => {
      const now = Date.now()
      const out: (T & SyncMeta)[] = []
      for (const r of records) {
        const existing = (await tbl.get(r.id)) as Stampable | undefined
        const stamped = this.stamp(r, existing, now)
        await tbl.put(stamped)
        await this.logChange(table, stamped.id, stamped.version, now)
        out.push(stamped)
      }
      await this.persistClock()
      return out
    })
  }

  async put<T extends Stampable>(table: SyncedTable, record: T): Promise<T & SyncMeta> {
    return (await this.putMany(table, [record]))[0]
  }

  /** Partial update of an existing record. */
  async patch<T extends SyncMeta>(table: SyncedTable, id: string, patch: Partial<T>): Promise<T | undefined> {
    const tbl = this.db.table(table)
    return this.db.transaction('rw', [tbl, this.db.changes, this.db.meta], async () => {
      const existing = (await tbl.get(id)) as T | undefined
      if (!existing) return undefined
      const now = Date.now()
      const stamped = this.stamp({ ...existing, ...patch, id }, existing, now) as T
      await tbl.put(stamped)
      await this.logChange(table, id, stamped.version, now)
      await this.persistClock()
      return stamped
    })
  }

  /** Soft delete (tombstone) – required so deletions can be synchronised later. */
  async remove(table: SyncedTable, ids: string[]): Promise<void> {
    if (ids.length === 0) return
    const tbl = this.db.table(table)
    await this.db.transaction('rw', [tbl, this.db.changes, this.db.meta], async () => {
      const now = Date.now()
      for (const id of ids) {
        const existing = (await tbl.get(id)) as SyncMeta | undefined
        if (!existing || existing.deletedAt) continue
        const stamped = this.stamp({ ...existing, deletedAt: now }, existing, now)
        await tbl.put(stamped)
        await this.logChange(table, id, stamped.version, now)
      }
      await this.persistClock()
    })
  }

  /** Run several repository calls atomically. */
  transaction<R>(fn: () => Promise<R>): Promise<R> {
    return this.db.transaction(
      'rw',
      [
        this.db.activities,
        this.db.categories,
        this.db.entries,
        this.db.overrides,
        this.db.challenges,
        this.db.settings,
        this.db.changes,
        this.db.meta,
      ],
      fn,
    )
  }

  async pendingChangeCount(sinceSeq = 0): Promise<number> {
    return this.db.changes.where('seq').above(sinceSeq).count()
  }
}
