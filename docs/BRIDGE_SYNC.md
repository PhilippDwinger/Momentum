# Bridge synchronisation – integration guide

Status: **not connected.** Momentum is fully local-first today. This document describes how
the existing architecture is prepared for synchronisation through *Bridge* and exactly where
the adapter has to be implemented. No Bridge API is assumed – the contract below is what
Momentum needs; map it onto whatever Bridge offers.

---

## 1. What is synchronised

All records in these IndexedDB tables (see `src/domain/types.ts`, `SYNCED_TABLES`):

| Table        | Content                                                                 | Id scheme                                   |
|--------------|-------------------------------------------------------------------------|---------------------------------------------|
| `activities` | Activity definition incl. schedule segments (recurrence rules), pauses, archive state, notes | UUIDv7                                      |
| `categories` | User categories and the 6 built-in ones                                 | UUIDv7, built-ins `cat_<key>`               |
| `entries`    | Progress per occurrence (value, target snapshot, note)                  | deterministic `e_<activityId>_<originalDate>` |
| `overrides`  | Per-occurrence exceptions: move, skip, custom target/time               | deterministic `o_<activityId>_<originalDate>` |
| `challenges` | Generated weekly challenges                                             | deterministic `ch_<weekMonday>_<type>`      |
| `settings`   | User-level settings (name, day boundary, week start, streak protection …) | fixed `settings`                            |

This covers activities, completion records, recurrence rules, schedule changes (segments and
overrides) and therefore the complete historical progress – statistics, streaks, XP and
achievements are **derived** from these records and are never synchronised themselves.

## 2. What stays local (never synchronised)

| Where                          | What                                                                 |
|--------------------------------|----------------------------------------------------------------------|
| IndexedDB `meta`               | `deviceId`, last HLC value, seed flag                                |
| IndexedDB `changes`            | the outbox (local change log)                                        |
| IndexedDB `syncState`          | per-transport cursor / progress                                      |
| localStorage `momentum.prefs.v1` | theme, language, calendar view, stats range, seen achievements, reminder bookkeeping |
| Service-worker cache           | static app shell only (no user data)                                 |

## 3. Identifiers

- User-created records use **UUIDv7** (`src/sync/clock.ts → uuidv7()`), globally unique and
  time-ordered. Never array positions or row numbers.
- Occurrences are *not stored*. An occurrence is identified by `activityId + originalDate`
  (`occKey`). Records attached to an occurrence (`entries`, `overrides`) derive their id from
  this identity. Consequence: if two devices complete the same occurrence offline, both write
  the **same record id** and the merge converges to one record instead of creating duplicates.
- Built-in categories use fixed ids (`cat_health`, …) and are seeded with the lowest possible
  version (`000000000000000:0000:seed`) and without an outbox entry, so a fresh device can never
  overwrite the user's renamed or deleted categories.

## 4. Change tracking

Every write goes through `LocalRepository` (`src/data/repository.ts`). In one IndexedDB
transaction it:

1. stamps `updatedAt` (wall clock, informational) and **`version`** – a hybrid logical clock
   value `<ms:15>:<counter:4,base36>:<deviceId>` (`HybridClock`). Versions are lexicographically
   comparable, monotonic per device and robust against small clock skew.
2. writes the full record,
3. appends `{table, id, version, at}` to the **outbox** (`changes`). The outbox is compacted:
   at most one entry per `(table, id)`; its auto-increment `seq` orders the changes.

`SyncService` pushes outbox entries with `seq > lastPushedSeq` and persists `lastPushedSeq`
after every acknowledged batch, so an interrupted sync simply resumes. The settings page shows
the number of queued changes.

Common metadata on every synchronised record (`SyncMeta`): `id`, `createdAt`, `updatedAt`,
`version`, `deletedAt`. The schema version lives once per database/export (`SCHEMA_VERSION` in
`src/data/db.ts`), not per record. Sync status is tracked per transport in `syncState`, not per
record.

## 5. Deletions

Deletions are **tombstones**: `deletedAt` is set and the record is kept (with a new `version`).
Deleting an activity tombstones the activity plus all of its entries and overrides
(`actions.deleteActivity`). Because a tombstone carries a newer version, it wins against stale
copies on other devices and is never resurrected. Tombstones are filtered out in `buildIndex`.

*Future housekeeping (optional):* tombstones older than N days can be purged once every device
has synced past them (Bridge would need to expose a "min acknowledged cursor").

## 6. Conflict resolution

`src/sync/merge.ts → applyRemoteRecords()` – **last-writer-wins per record** by HLC `version`:

- remote version greater than local → take remote, otherwise keep local; equal → no-op.
- invalid version strings are rejected.
- remote-applied records are *not* written to the outbox (no echo), imports are.

Why this is enough for Momentum:

- Progress and per-occurrence edits are separate small records with deterministic ids, so
  concurrent work on *different* days/activities never conflicts.
- A real conflict needs the *same* record edited on two devices between syncs (e.g. renaming
  the same activity) – the later edit wins, which matches user expectations.
- Schedule edits "this and future" append schedule segments inside the activity record; history
  is never rewritten, and entries keep their own target snapshot.

Possible refinement later: field-level merge for `activities` (keep a per-field version map).
The interface does not need to change for that.

## 7. How the Bridge adapter interacts with the app

```
UI ──► actions.ts ──► LocalRepository ──► IndexedDB (+ outbox)
                                            ▲         │
                                            │ apply   │ read pending
                                  SyncService ◄───────┘
                                            │ push / pull
                                    BridgeSyncAdapter (SyncTransport) ──► Bridge
```

The UI never talks to the adapter. It keeps reading IndexedDB through `useLiveQuery`; records
applied by a pull appear automatically.

### The transport contract (`src/sync/types.ts → SyncTransport`)

```ts
interface SyncTransport {
  readonly id: string        // 'bridge' – also the key of the persisted SyncState
  readonly label: string
  isAvailable(): Promise<boolean>
  push(records: SyncRecord[], ctx: SyncContext): Promise<void>
  pull(cursor: string | null, ctx: SyncContext): Promise<PullResult>
}
type SyncRecord = { table: SyncedTable; record: SyncMeta & Record<string, unknown> }
type PullResult = { records: SyncRecord[]; cursor: string | null; hasMore: boolean }
```

Requirements for the Bridge side:

1. **Store** per `(table, id)` the record with the highest `version` (string comparison).
   Pushing the same record twice must be harmless.
2. **Change feed:** return records changed since an opaque `cursor`, paginated (`hasMore`).
   Returning a device's own records again is fine (LWW makes it a no-op).
3. Treat records as opaque JSON; only `table`, `id`, `version`, `deletedAt` matter to Bridge.
4. Authentication/transport (HTTP, WebSocket, …) is entirely up to the adapter.

## 8. Implementing the adapter – step by step

1. **`src/sync/BridgeSyncAdapter.ts`** – replace the placeholder methods:
   - `isAvailable()` → return `true` when Bridge is configured and reachable.
   - `push()` → send the batch (≤ 200 records per call, see `PUSH_BATCH`).
   - `pull()` → fetch the next page after `cursor`.
2. **Configuration** – add Bridge settings (URL/token) as *device-local* values (e.g. in the
   `meta` table or `Prefs` in `src/state/prefs.ts`; never in the synchronised `settings`).
3. **Wire the service** – create one `SyncService(getRepository(), new BridgeSyncAdapter())`
   after `LocalRepository.open()` in `src/main.tsx`, and call `sync()`:
   - on app start and when `online` fires,
   - debounced (e.g. 2 s) after local writes (subscribe to `db.changes` with `liveQuery`),
   - periodically while visible (e.g. every 60 s).
   `sync()` is re-entrant-safe (concurrent calls share one run).
4. **Settings UI** – `src/pages/SettingsPage.tsx`, section "Synchronisation": replace the static
   "Nicht verbunden" badge with `SyncState.status`, `lastSyncAt`, `lastError` and a
   "Jetzt synchronisieren" button.
5. **Tests** – `tests/sync.test.ts` already contains an in-memory transport (`MemoryServer`)
   that verifies two-device replication, LWW conflicts, tombstones and resumable pushes. Point a
   copy of these tests at a Bridge test instance.

### Interfaces to extend (and only these)

| File                          | Change                                                    |
|-------------------------------|-----------------------------------------------------------|
| `src/sync/BridgeSyncAdapter.ts` | implement transport                                     |
| `src/main.tsx`                | instantiate + trigger `SyncService`                       |
| `src/pages/SettingsPage.tsx`  | show sync status / configuration                          |
| `src/state/prefs.ts` (or `meta`) | device-local Bridge configuration                      |

No changes are needed in the domain layer, the repository, the UI pages or the data model.

### Schema evolution

Bump `SCHEMA_VERSION` (and add a Dexie `version(n).upgrade()` step) when the record shape
changes. `SyncContext.schemaVersion` is sent with every push/pull so Bridge (or older clients)
can refuse incompatible data. Imports from newer schema versions are already rejected.
