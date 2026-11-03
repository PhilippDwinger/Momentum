import type { ID, SyncMeta, SyncedTable } from '../domain/types'

/**
 * Contracts for (future) synchronisation. The app works fully without any transport.
 * A transport (e.g. the Bridge adapter) only moves `SyncRecord`s; merging is done locally
 * by `applyRemoteRecords` using last-writer-wins on the HLC `version`.
 */

/** A full record snapshot including tombstones (deletedAt != null). */
export type SyncRecordData = SyncMeta & Record<string, unknown>

export interface SyncRecord {
  table: SyncedTable
  record: SyncRecordData
}

/** Local change log ("outbox"). Compacted: at most one entry per (table, id). */
export interface ChangeLogEntry {
  seq?: number
  table: SyncedTable
  id: ID
  version: string
  at: number
}

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'error'

/** Persistent progress of a sync target. Allows resuming an interrupted sync. */
export interface SyncState {
  id: string
  status: SyncStatus
  /** Highest change-log seq that the remote acknowledged. */
  lastPushedSeq: number
  /** Opaque cursor returned by the remote for incremental pulls. */
  remoteCursor: string | null
  lastSyncAt: number | null
  lastError: string | null
}

export interface PullResult {
  records: SyncRecord[]
  /** Cursor to persist after the page has been applied. */
  cursor: string | null
  hasMore: boolean
}

export interface SyncContext {
  deviceId: string
  schemaVersion: number
}

/**
 * A sync transport. Implementations must be idempotent: pushing the same record twice or
 * pulling the same page twice must be harmless (LWW merge makes re-application a no-op).
 */
export interface SyncTransport {
  readonly id: string
  readonly label: string
  isAvailable(): Promise<boolean>
  push(records: SyncRecord[], ctx: SyncContext): Promise<void>
  pull(cursor: string | null, ctx: SyncContext): Promise<PullResult>
}

export interface SyncReport {
  pushed: number
  pulled: number
  applied: number
  conflictsResolved: number
}
