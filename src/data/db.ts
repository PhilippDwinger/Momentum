import Dexie, { type Table } from 'dexie'
import type { Activity, Category, Challenge, Entry, OccurrenceOverride, SyncedTable, UserSettings } from '../domain/types'
import type { ChangeLogEntry, SyncState } from '../sync/types'

/** Bump when the stored data shape changes; also written into exports. */
export const SCHEMA_VERSION = 1

export interface MetaRow {
  key: string
  value: unknown
}

/**
 * IndexedDB schema (Dexie). Only indexed fields are listed in the schema strings.
 * Occurrences are *not* stored – they are evaluated from schedule segments on demand.
 */
export class MomentumDB extends Dexie {
  activities!: Table<Activity, string>
  categories!: Table<Category, string>
  entries!: Table<Entry, string>
  overrides!: Table<OccurrenceOverride, string>
  challenges!: Table<Challenge, string>
  settings!: Table<UserSettings, string>
  /** Outbox of local changes for a future sync transport. */
  changes!: Table<ChangeLogEntry, number>
  /** Per-transport sync progress (local only). */
  syncState!: Table<SyncState, string>
  /** Device-local values (deviceId, last clock value …). Never synchronised. */
  meta!: Table<MetaRow, string>

  constructor(name = 'momentum') {
    super(name)
    this.version(1).stores({
      activities: 'id, updatedAt, deletedAt',
      categories: 'id, updatedAt',
      entries: 'id, activityId, date, updatedAt',
      overrides: 'id, activityId, date, movedTo, updatedAt',
      challenges: 'id, week',
      settings: 'id',
      changes: '++seq, &[table+id], at',
      syncState: 'id',
      meta: 'key',
    })
  }

  syncedTable(name: SyncedTable): Table<{ id: string; version: string; deletedAt: number | null }, string> {
    return this.table(name)
  }
}
