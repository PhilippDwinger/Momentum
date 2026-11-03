/**
 * Core domain types for Momentum.
 *
 * Conventions
 * - `DateKey` is a *local calendar date* in the form `YYYY-MM-DD`. It is never a UTC
 *   timestamp. All day-based logic (recurrence, streaks, statistics) works on DateKeys.
 * - Instants (when something happened) are stored as epoch milliseconds.
 * - Every persisted record carries `SyncMeta` so a future sync layer (Bridge) can
 *   replicate it without schema changes. See docs/BRIDGE_SYNC.md.
 */

export type DateKey = string
export type ID = string

/** Metadata shared by every synchronisable record. */
export interface SyncMeta {
  /** Stable, globally unique identifier (UUIDv7 or deterministic composite key). */
  id: ID
  /** Epoch ms of creation (informational). */
  createdAt: number
  /** Epoch ms of last local modification (informational). */
  updatedAt: number
  /** Hybrid logical clock timestamp of the last change. Used for conflict resolution. */
  version: string
  /** Tombstone: epoch ms when the record was deleted, otherwise null. */
  deletedAt: number | null
}

export type ColorKey =
  | 'ember'
  | 'amber'
  | 'lime'
  | 'green'
  | 'teal'
  | 'sky'
  | 'blue'
  | 'indigo'
  | 'violet'
  | 'pink'
  | 'slate'

export const COLOR_KEYS: ColorKey[] = [
  'ember',
  'amber',
  'lime',
  'green',
  'teal',
  'sky',
  'blue',
  'indigo',
  'violet',
  'pink',
  'slate',
]

/**
 * - check:    simple checkbox (target 1)
 * - duration: minutes (target e.g. 15)
 * - count:    whole numbers with a unit (e.g. 10 pages)
 * - custom:   any measurable value with decimals and a free unit (e.g. 5.5 km)
 */
export type ActivityKind = 'check' | 'duration' | 'count' | 'custom'

export type Frequency = 'once' | 'daily' | 'weekly' | 'monthly'

/** ISO weekday: 1 = Monday … 7 = Sunday */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface RecurrenceRule {
  freq: Frequency
  /** Repeat every n days / weeks / months (>= 1). Ignored for `once`. */
  interval: number
  /** Weekly: which weekdays. Empty/undefined = weekday of the anchor date. */
  weekdays?: Weekday[]
  /** Monthly: by day of month (`day`) or by nth weekday (`weekday`). */
  monthlyMode?: 'day' | 'weekday'
  /** Monthly/day: 1..31, clamped to the month length. Default: anchor day. */
  monthDay?: number
  /** Monthly/weekday: 1..4 or -1 for "last". */
  nth?: number
  /** Monthly/weekday: ISO weekday. */
  nthWeekday?: Weekday
}

/**
 * A schedule segment applies from `from` (inclusive) until the next segment starts.
 * "Edit this and future occurrences" appends a new segment instead of rewriting history.
 * `from` is also the anchor for interval-based rules (every 2 weeks, every 3 days …).
 */
export interface ScheduleSegment {
  from: DateKey
  rule: RecurrenceRule
  /** Target value for occurrences in this segment (check: always 1). */
  target: number
}

export interface Activity extends SyncMeta {
  name: string
  description: string
  /** `i:<icon-name>` for a built-in line icon, otherwise an emoji / short text. */
  icon: string
  color: ColorKey
  categoryId: ID | null
  kind: ActivityKind
  /** Unit label for count/custom (duration always uses minutes). */
  unit: string
  startDate: DateKey
  /** Optional last day (inclusive) on which occurrences are generated. */
  endDate: DateKey | null
  /** Sorted ascending by `from`; schedule[0].from === startDate. */
  schedule: ScheduleSegment[]
  /** Planned time of day `HH:MM`, optional. */
  time: string | null
  /** Planned duration in minutes (informational; used for workload hints). */
  durationMinutes: number | null
  /** Local reminder time `HH:MM` or null. */
  reminderTime: string | null
  /** Whether partial progress keeps the streak alive. */
  partialCounts: boolean
  notes: string
  /** When archived: occurrences from this date on are no longer generated. History stays. */
  archivedAt: DateKey | null
  /** Inclusive date ranges without occurrences (e.g. the time an activity was archived). */
  pauses: DateRange[]
  sortOrder: number
}

export interface DateRange {
  from: DateKey
  to: DateKey
}

export interface Category extends SyncMeta {
  /** User-defined name. Empty for untouched built-in categories (then localized). */
  name: string
  /** Key of a built-in default category, e.g. `health`. */
  builtin: string | null
  color: ColorKey
  icon: string
  sortOrder: number
}

/**
 * Progress record for one occurrence. Deterministic id `e_<activityId>_<originalDate>` so the
 * same occurrence logged on two devices converges to one record.
 */
export interface Entry extends SyncMeta {
  activityId: ID
  /** Original (scheduled) date of the occurrence – the occurrence identity. */
  date: DateKey
  value: number
  /** Snapshot of the target at the time of logging (keeps history stable). */
  target: number
  note: string
  /** Epoch ms of the last progress change. */
  loggedAt: number
}

/**
 * Per-occurrence exception ("edit this occurrence"). Deterministic id
 * `o_<activityId>_<originalDate>`.
 */
export interface OccurrenceOverride extends SyncMeta {
  activityId: ID
  /** Original date of the occurrence. */
  date: DateKey
  skipped: boolean
  movedTo: DateKey | null
  target: number | null
  time: string | null
}

export type ChallengeType = 'completions' | 'perfectDays' | 'activityAll'

export interface Challenge extends SyncMeta {
  /** First day (Monday) of the ISO week. */
  week: DateKey
  type: ChallengeType
  goal: number
  activityId: ID | null
  xp: number
}

/** Settings that follow the user across devices (synchronised). */
export interface UserSettings extends SyncMeta {
  name: string
  /** Hour (0–6) at which a new day starts; e.g. 4 means 02:00 still counts as yesterday. */
  dayStartHour: number
  weekStartsOn: 0 | 1
  streakProtection: boolean
  /** Smart scheduling: hint when a day has more than this many activities. */
  overloadThreshold: number
  showMotivation: boolean
}

/** Derived (never stored) – one concrete occurrence of an activity. */
export interface Occurrence {
  /** Stable occurrence id: `<activityId>_<originalDate>`. */
  key: string
  activityId: ID
  originalDate: DateKey
  /** Effective date (after a move). */
  date: DateKey
  target: number
  time: string | null
  moved: boolean
  skipped: boolean
  /** Progress exists for a date that is no longer part of the schedule. */
  unplanned: boolean
  entry: Entry | null
  override: OccurrenceOverride | null
}

export type OccurrenceStatus = 'done' | 'partial' | 'missed' | 'pending' | 'upcoming' | 'skipped'

export const SYNCED_TABLES = ['activities', 'categories', 'entries', 'overrides', 'challenges', 'settings'] as const
export type SyncedTable = (typeof SYNCED_TABLES)[number]
