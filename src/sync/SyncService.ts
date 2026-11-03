import type { SyncedTable } from '../domain/types'
import { SCHEMA_VERSION } from '../data/db'
import type { LocalRepository } from '../data/repository'
import { applyRemoteRecords } from './merge'
import type { SyncRecord, SyncRecordData, SyncReport, SyncState, SyncTransport } from './types'

const PUSH_BATCH = 200
const MAX_PULL_PAGES = 1000

/**
 * Orchestrates synchronisation with a `SyncTransport`.
 *
 * Algorithm (resumable – every step persists its progress):
 *  1. PUSH: read outbox entries with seq > lastPushedSeq, load the current record snapshot
 *     (tombstones included) and push in batches. After each acknowledged batch,
 *     `lastPushedSeq` is persisted. An interruption only causes re-sending (idempotent).
 *  2. PULL: request pages starting at `remoteCursor`, merge each page via LWW
 *     (`applyRemoteRecords`) and persist the cursor after every page.
 *
 * Without a transport (current state) the service is never started. See docs/BRIDGE_SYNC.md.
 */
export class SyncService {
  private readonly repo: LocalRepository
  private readonly transport: SyncTransport
  private running: Promise<SyncReport> | null = null

  constructor(repo: LocalRepository, transport: SyncTransport) {
    this.repo = repo
    this.transport = transport
  }

  get stateId(): string {
    return `sync:${this.transport.id}`
  }

  async getState(): Promise<SyncState> {
    return (
      (await this.repo.db.syncState.get(this.stateId)) ?? {
        id: this.stateId,
        status: 'idle',
        lastPushedSeq: 0,
        remoteCursor: null,
        lastSyncAt: null,
        lastError: null,
      }
    )
  }

  private async saveState(patch: Partial<SyncState>): Promise<SyncState> {
    const next = { ...(await this.getState()), ...patch }
    await this.repo.db.syncState.put(next)
    return next
  }

  /** Runs one full push + pull cycle. Concurrent calls share the same run. */
  sync(): Promise<SyncReport> {
    if (!this.running) {
      this.running = this.run().finally(() => {
        this.running = null
      })
    }
    return this.running
  }

  private async run(): Promise<SyncReport> {
    const ctx = { deviceId: this.repo.deviceId, schemaVersion: SCHEMA_VERSION }
    const report: SyncReport = { pushed: 0, pulled: 0, applied: 0, conflictsResolved: 0 }
    if (!(await this.transport.isAvailable())) {
      await this.saveState({ status: 'disabled' })
      return report
    }
    await this.saveState({ status: 'syncing', lastError: null })
    try {
      // 1) push
      let state = await this.getState()
      for (;;) {
        const batch = await this.repo.db.changes.where('seq').above(state.lastPushedSeq).limit(PUSH_BATCH).toArray()
        if (batch.length === 0) break
        const records: SyncRecord[] = []
        for (const c of batch) {
          const record = (await this.repo.db.table(c.table).get(c.id)) as SyncRecordData | undefined
          if (record) records.push({ table: c.table as SyncedTable, record })
        }
        await this.transport.push(records, ctx)
        report.pushed += records.length
        state = await this.saveState({ lastPushedSeq: batch[batch.length - 1].seq! })
      }
      // 2) pull
      for (let page = 0; page < MAX_PULL_PAGES; page++) {
        const res = await this.transport.pull(state.remoteCursor, ctx)
        report.pulled += res.records.length
        const applied = await applyRemoteRecords(this.repo, res.records)
        report.applied += applied.applied
        report.conflictsResolved += applied.skipped
        state = await this.saveState({ remoteCursor: res.cursor })
        if (!res.hasMore) break
      }
      await this.saveState({ status: 'idle', lastSyncAt: Date.now() })
      return report
    } catch (err) {
      await this.saveState({ status: 'error', lastError: err instanceof Error ? err.message : String(err) })
      throw err
    }
  }
}
