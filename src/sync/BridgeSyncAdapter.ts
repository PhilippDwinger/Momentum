import type { PullResult, SyncContext, SyncRecord, SyncTransport } from './types'

/**
 * BridgeSyncAdapter – placeholder for the future Bridge transport.
 *
 * Status: NOT CONNECTED. Bridge is a separate project; its API is not known to this
 * codebase yet, so no endpoints are assumed here. `isAvailable()` returns false, which makes
 * `SyncService` a no-op and the app runs purely local.
 *
 * To implement (see docs/BRIDGE_SYNC.md, section "Implementing the adapter"):
 *  - `isAvailable()`: return true once Bridge is configured and reachable.
 *  - `push(records)`: send full record snapshots (incl. tombstones) to Bridge. Must be
 *    idempotent; Bridge should store per (table, id) the record with the highest `version`.
 *  - `pull(cursor)`: return records changed since `cursor` (Bridge-defined opaque string),
 *    paginated via `hasMore`. Records pushed by this device may be returned – harmless.
 */
export class BridgeSyncAdapter implements SyncTransport {
  readonly id = 'bridge'
  readonly label = 'Bridge'

  async isAvailable(): Promise<boolean> {
    return false
  }

  async push(_records: SyncRecord[], _ctx: SyncContext): Promise<void> {
    throw new BridgeNotConnectedError()
  }

  async pull(_cursor: string | null, _ctx: SyncContext): Promise<PullResult> {
    throw new BridgeNotConnectedError()
  }
}

export class BridgeNotConnectedError extends Error {
  constructor() {
    super('Bridge synchronisation is not connected yet.')
    this.name = 'BridgeNotConnectedError'
  }
}
