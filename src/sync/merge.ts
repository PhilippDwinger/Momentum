import type { SyncedTable } from '../domain/types'
import { SYNCED_TABLES } from '../domain/types'
import type { LocalRepository } from '../data/repository'
import { compareVersions, parseHlc } from './clock'
import type { SyncRecord, SyncRecordData } from './types'

/**
 * Conflict resolution: last-writer-wins per record, decided by the HLC `version`.
 * Ties (same version) are identical writes and therefore no-ops.
 *
 * Why record-level LWW is sufficient here:
 * - Progress entries and overrides use deterministic ids (`e_<activity>_<date>`), so the
 *   same occurrence edited on two devices converges to one record.
 * - Deletions are tombstones with a newer version, so they win over stale edits and are
 *   never "resurrected" by an old copy.
 */
export function remoteWins(local: SyncRecordData | undefined, remote: SyncRecordData): boolean {
  if (!local) return true
  return compareVersions(remote.version, local.version) > 0
}

export interface ApplyOptions {
  /**
   * Also log the applied records into the outbox (used for imports – the data is new for any
   * future remote). Remote sync pulls must NOT log, otherwise changes would echo back.
   */
  logChanges?: boolean
}

export interface ApplyResult {
  applied: number
  skipped: number
}

export async function applyRemoteRecords(
  repo: LocalRepository,
  records: SyncRecord[],
  opts: ApplyOptions = {},
): Promise<ApplyResult> {
  const db = repo.db
  let applied = 0
  let skipped = 0
  const tables = SYNCED_TABLES.map((t) => db.table(t))
  await db.transaction('rw', [...tables, db.changes, db.meta], async () => {
    for (const { table, record } of records) {
      if (!(SYNCED_TABLES as readonly string[]).includes(table)) {
        skipped++
        continue
      }
      if (!parseHlc(record.version)) {
        skipped++
        continue
      }
      const tbl = db.table(table as SyncedTable)
      const local = (await tbl.get(record.id)) as SyncRecordData | undefined
      repo.clock.receive(record.version)
      if (!remoteWins(local, record)) {
        skipped++
        continue
      }
      await tbl.put(record)
      applied++
      if (opts.logChanges) {
        const prev = await db.changes.where('[table+id]').equals([table, record.id]).first()
        if (prev?.seq !== undefined) await db.changes.delete(prev.seq)
        await db.changes.add({ table, id: record.id, version: record.version, at: Date.now() })
      }
    }
    await db.meta.put({ key: 'clock', value: repo.clock.current })
  })
  return { applied, skipped }
}
