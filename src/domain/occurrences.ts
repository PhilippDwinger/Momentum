import { parseTime } from './dates'
import { isScheduled, scheduledDates, targetFor } from './recurrence'
import type {
  Activity,
  Category,
  Challenge,
  DateKey,
  Entry,
  ID,
  Occurrence,
  OccurrenceOverride,
  OccurrenceStatus,
  UserSettings,
} from './types'

export interface DataSnapshot {
  activities: Activity[]
  categories: Category[]
  entries: Entry[]
  overrides: OccurrenceOverride[]
  challenges: Challenge[]
  settings: UserSettings
}

/** In-memory index over the (non-deleted) data – rebuilt whenever data changes. */
export interface DataIndex {
  activities: Activity[]
  activityById: Map<ID, Activity>
  categories: Category[]
  categoryById: Map<ID, Category>
  /** occurrence key -> entry */
  entries: Map<string, Entry>
  entriesByActivity: Map<ID, Entry[]>
  /** occurrence key -> override */
  overrides: Map<string, OccurrenceOverride>
  /** activityId -> overrides that move an occurrence */
  movesByActivity: Map<ID, OccurrenceOverride[]>
  challenges: Challenge[]
  settings: UserSettings
}

export const occKey = (activityId: ID, originalDate: DateKey) => `${activityId}_${originalDate}`

export function buildIndex(snap: DataSnapshot): DataIndex {
  const activities = snap.activities
    .filter((a) => !a.deletedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt)
  const activityById = new Map(activities.map((a) => [a.id, a]))
  const categories = snap.categories.filter((c) => !c.deletedAt).sort((a, b) => a.sortOrder - b.sortOrder)
  const entries = new Map<string, Entry>()
  const entriesByActivity = new Map<ID, Entry[]>()
  for (const e of snap.entries) {
    if (e.deletedAt || !activityById.has(e.activityId)) continue
    entries.set(occKey(e.activityId, e.date), e)
    const list = entriesByActivity.get(e.activityId) ?? []
    list.push(e)
    entriesByActivity.set(e.activityId, list)
  }
  const overrides = new Map<string, OccurrenceOverride>()
  const movesByActivity = new Map<ID, OccurrenceOverride[]>()
  for (const o of snap.overrides) {
    if (o.deletedAt || !activityById.has(o.activityId)) continue
    overrides.set(occKey(o.activityId, o.date), o)
    if (o.movedTo && o.movedTo !== o.date) {
      const list = movesByActivity.get(o.activityId) ?? []
      list.push(o)
      movesByActivity.set(o.activityId, list)
    }
  }
  return {
    activities,
    activityById,
    categories,
    categoryById: new Map(categories.map((c) => [c.id, c])),
    entries,
    entriesByActivity,
    overrides,
    movesByActivity,
    challenges: snap.challenges.filter((c) => !c.deletedAt),
    settings: snap.settings,
  }
}

function makeOccurrence(index: DataIndex, a: Activity, originalDate: DateKey, unplanned = false): Occurrence {
  const key = occKey(a.id, originalDate)
  const override = index.overrides.get(key) ?? null
  const entry = index.entries.get(key) ?? null
  const date = override?.movedTo ?? originalDate
  return {
    key,
    activityId: a.id,
    originalDate,
    date,
    target: override?.target ?? targetFor(a, originalDate),
    time: override?.time ?? a.time,
    moved: date !== originalDate,
    skipped: !!override?.skipped,
    unplanned,
    entry,
    override,
  }
}

/** Resolve a single occurrence by its identity (activity + original date). */
export function getOccurrence(index: DataIndex, activityId: ID, originalDate: DateKey): Occurrence | null {
  const a = index.activityById.get(activityId)
  if (!a) return null
  const scheduled = isScheduled(a, originalDate)
  const entry = index.entries.get(occKey(activityId, originalDate))
  if (!scheduled && !(entry && entry.value > 0)) return null
  return makeOccurrence(index, a, originalDate, !scheduled)
}

/**
 * All occurrences of one activity whose *effective* date lies in [from, to].
 * Includes occurrences moved into the range, excludes those moved out of it, and
 * surfaces progress that exists for dates no longer in the schedule ("unplanned").
 */
export function activityOccurrences(index: DataIndex, a: Activity, from: DateKey, to: DateKey): Occurrence[] {
  const out: Occurrence[] = []
  const seen = new Set<string>()
  for (const d of scheduledDates(a, from, to)) {
    const occ = makeOccurrence(index, a, d)
    seen.add(occ.key)
    if (occ.date >= from && occ.date <= to) out.push(occ)
  }
  for (const mv of index.movesByActivity.get(a.id) ?? []) {
    const target = mv.movedTo!
    if (target < from || target > to) continue
    const key = occKey(a.id, mv.date)
    if (seen.has(key) || !isScheduled(a, mv.date)) continue
    seen.add(key)
    out.push(makeOccurrence(index, a, mv.date))
  }
  for (const e of index.entriesByActivity.get(a.id) ?? []) {
    if (e.date < from || e.date > to || e.value <= 0) continue
    const key = occKey(a.id, e.date)
    if (seen.has(key) || isScheduled(a, e.date)) continue
    seen.add(key)
    out.push(makeOccurrence(index, a, e.date, true))
  }
  out.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.originalDate < y.originalDate ? -1 : 1))
  return out
}

/** Occurrences of all (or the given) activities in a date range, grouped by effective date. */
export function occurrencesByDate(
  index: DataIndex,
  from: DateKey,
  to: DateKey,
  activities: Activity[] = index.activities,
): Map<DateKey, Occurrence[]> {
  const map = new Map<DateKey, Occurrence[]>()
  for (const a of activities) {
    for (const occ of activityOccurrences(index, a, from, to)) {
      const list = map.get(occ.date) ?? []
      list.push(occ)
      map.set(occ.date, list)
    }
  }
  for (const list of map.values()) sortOccurrences(index, list)
  return map
}

export function occurrencesOn(index: DataIndex, date: DateKey, activities?: Activity[]): Occurrence[] {
  return occurrencesByDate(index, date, date, activities).get(date) ?? []
}

export function sortOccurrences(index: DataIndex, list: Occurrence[]): Occurrence[] {
  return list.sort((x, y) => {
    const tx = parseTime(x.time) ?? 24 * 60
    const ty = parseTime(y.time) ?? 24 * 60
    if (tx !== ty) return tx - ty
    const ax = index.activityById.get(x.activityId)
    const ay = index.activityById.get(y.activityId)
    return (ax?.sortOrder ?? 0) - (ay?.sortOrder ?? 0)
  })
}

/** Fraction of the target reached, 0..1. */
export function progressOf(occ: Occurrence): number {
  const v = occ.entry?.value ?? 0
  const t = occ.target > 0 ? occ.target : 1
  return Math.max(0, Math.min(1, v / t))
}

export function isDone(occ: Occurrence): boolean {
  return progressOf(occ) >= 1
}

export function statusOf(occ: Occurrence, today: DateKey): OccurrenceStatus {
  if (occ.skipped) return 'skipped'
  const p = progressOf(occ)
  if (p >= 1) return 'done'
  if (occ.date > today) return 'upcoming'
  if (p > 0) return 'partial'
  return occ.date === today ? 'pending' : 'missed'
}

/** Counts towards streaks / completion when done, or partial if the activity allows it. */
export function countsAsSuccess(occ: Occurrence, activity: Activity): boolean {
  const p = progressOf(occ)
  return p >= 1 || (activity.partialCounts && p > 0)
}

/** Occurrences that are part of the plan (not skipped, not unplanned extras). */
export function isPlanned(occ: Occurrence): boolean {
  return !occ.skipped && !occ.unplanned
}
