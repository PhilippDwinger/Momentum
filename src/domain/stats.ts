import { addDays, addMonths, diffDays, rangeKeys, startOfMonth, startOfWeek, weekday } from './dates'
import {
  activityOccurrences,
  isDone,
  isPlanned,
  occurrencesByDate,
  progressOf,
  statusOf,
  type DataIndex,
} from './occurrences'
import { computeStreak, type StreakInfo } from './streaks'
import type { Activity, DateKey, ID, Occurrence } from './types'

/**
 * Statistics are always derived from stored entries + schedule – never cached counters.
 *
 * Definitions (kept deliberately honest):
 * - planned:   scheduled, not skipped occurrences
 * - evaluated: planned occurrences that can be judged (date < today, or today and already
 *              progressed). Today's open items do not count as missed.
 * - rate:      done / evaluated. Days without anything planned are excluded, never "failed".
 */

export interface DaySummary {
  date: DateKey
  planned: number
  evaluated: number
  done: number
  partial: number
  missed: number
  skipped: number
  open: number
  /** Sum of progress fractions of planned occurrences (partial credit). */
  score: number
  unplannedDone: number
}

export interface StatsFilter {
  activityId?: ID | null
  categoryId?: ID | null
  includeArchived?: boolean
}

export function filterActivities(index: DataIndex, filter: StatsFilter = {}): Activity[] {
  return index.activities.filter((a) => {
    if (filter.activityId && a.id !== filter.activityId) return false
    if (filter.categoryId && a.categoryId !== filter.categoryId) return false
    return true
  })
}

export function summarizeDay(date: DateKey, occs: Occurrence[], today: DateKey): DaySummary {
  const s: DaySummary = {
    date,
    planned: 0,
    evaluated: 0,
    done: 0,
    partial: 0,
    missed: 0,
    skipped: 0,
    open: 0,
    score: 0,
    unplannedDone: 0,
  }
  for (const occ of occs) {
    if (occ.unplanned) {
      if (isDone(occ)) s.unplannedDone++
      continue
    }
    if (occ.skipped) {
      s.skipped++
      continue
    }
    s.planned++
    s.score += progressOf(occ)
    const st = statusOf(occ, today)
    if (st === 'done') s.done++
    else if (st === 'partial') s.partial++
    else if (st === 'missed') s.missed++
    else s.open++
  }
  // Past days are final. Today only judges what is already completed; open or partially
  // done items today are not yet counted against the rate. Future days are not evaluated.
  if (date < today) s.evaluated = s.done + s.partial + s.missed
  else if (date === today) s.evaluated = s.done
  return s
}

export function daySummaries(
  index: DataIndex,
  from: DateKey,
  to: DateKey,
  today: DateKey,
  activities: Activity[] = index.activities,
): Map<DateKey, DaySummary> {
  const byDate = occurrencesByDate(index, from, to, activities)
  const map = new Map<DateKey, DaySummary>()
  for (const d of rangeKeys(from, to)) map.set(d, summarizeDay(d, byDate.get(d) ?? [], today))
  return map
}

export interface Totals {
  planned: number
  evaluated: number
  done: number
  partial: number
  missed: number
  skipped: number
  daysWithPlan: number
  perfectDays: number
  rate: number | null
}

export function totalsOf(days: Iterable<DaySummary>, today: DateKey): Totals {
  const t: Totals = { planned: 0, evaluated: 0, done: 0, partial: 0, missed: 0, skipped: 0, daysWithPlan: 0, perfectDays: 0, rate: null }
  for (const d of days) {
    if (d.date > today) continue
    t.planned += d.planned
    t.evaluated += d.evaluated
    t.done += d.done
    t.partial += d.partial
    t.missed += d.missed
    t.skipped += d.skipped
    if (d.planned > 0) t.daysWithPlan++
    if (d.planned > 0 && d.done === d.planned) t.perfectDays++
  }
  t.rate = t.evaluated > 0 ? t.done / t.evaluated : null
  return t
}

/**
 * Heatmap level: -1 future, 0 nothing planned, 1 planned but nothing done,
 * 2 under half, 3 half or more, 4 everything done (partial progress gives partial credit).
 */
export function heatLevel(d: DaySummary | undefined, today: DateKey): number {
  if (!d) return 0
  if (d.date > today) return -1
  if (d.planned === 0) return 0
  const ratio = d.score / d.planned
  if (ratio >= 1) return 4
  if (ratio >= 0.5) return 3
  if (ratio > 0) return 2
  return 1
}

export interface Bucket {
  start: DateKey
  end: DateKey
  totals: Totals
}

export function weeklyBuckets(
  index: DataIndex,
  weeks: number,
  today: DateKey,
  weekStartsOn: 0 | 1,
  activities?: Activity[],
): Bucket[] {
  const lastStart = startOfWeek(today, weekStartsOn)
  const firstStart = addDays(lastStart, -7 * (weeks - 1))
  const days = daySummaries(index, firstStart, addDays(lastStart, 6), today, activities)
  const out: Bucket[] = []
  for (let i = 0; i < weeks; i++) {
    const start = addDays(firstStart, i * 7)
    const end = addDays(start, 6)
    const list = rangeKeys(start, end).map((k) => days.get(k)!)
    out.push({ start, end, totals: totalsOf(list, today) })
  }
  return out
}

export function monthlyBuckets(index: DataIndex, months: number, today: DateKey, activities?: Activity[]): Bucket[] {
  const lastStart = startOfMonth(today)
  const firstStart = addMonths(lastStart, -(months - 1))
  const days = daySummaries(index, firstStart, today, today, activities)
  const out: Bucket[] = []
  for (let i = 0; i < months; i++) {
    const start = addMonths(firstStart, i)
    const end = addDays(addMonths(start, 1), -1)
    const list = rangeKeys(start, end < today ? end : today).map((k) => days.get(k)!).filter(Boolean)
    out.push({ start, end, totals: totalsOf(list, today) })
  }
  return out
}

export interface ActivityStats {
  activity: Activity
  totals: Totals
  streak: StreakInfo
  /** Average logged value for measurable activities (over progressed occurrences). */
  avgValue: number | null
  totalValue: number
  /** Completions per week in the range. */
  perWeek: number
  lastDone: DateKey | null
}

export function activityStats(index: DataIndex, a: Activity, from: DateKey, today: DateKey): ActivityStats {
  const start = from < a.startDate ? a.startDate : from
  const occs = start <= today ? activityOccurrences(index, a, start, today) : []
  const byDate = new Map<DateKey, Occurrence[]>()
  for (const o of occs) byDate.set(o.date, [...(byDate.get(o.date) ?? []), o])
  const days = [...byDate.entries()].map(([d, list]) => summarizeDay(d, list, today))
  const totals = totalsOf(days, today)
  let sum = 0
  let n = 0
  let lastDone: DateKey | null = null
  for (const o of occs) {
    const v = o.entry?.value ?? 0
    if (v > 0) {
      sum += v
      n++
    }
    if (isDone(o) && (!lastDone || o.date > lastDone)) lastDone = o.date
  }
  const spanDays = Math.max(1, diffDays(start, today) + 1)
  return {
    activity: a,
    totals,
    streak: computeStreak(index, a, today),
    avgValue: a.kind === 'check' || n === 0 ? null : sum / n,
    totalValue: sum,
    perWeek: (totals.done / spanDays) * 7,
    lastDone,
  }
}

/** Completion rate per ISO weekday (1..7) in a range. */
export function weekdayPattern(days: Iterable<DaySummary>, today: DateKey): { weekday: number; rate: number | null; evaluated: number }[] {
  const acc = Array.from({ length: 7 }, () => ({ done: 0, evaluated: 0 }))
  for (const d of days) {
    if (d.date > today) continue
    const i = weekday(d.date) - 1
    acc[i].done += d.done
    acc[i].evaluated += d.evaluated
  }
  return acc.map((a, i) => ({ weekday: i + 1, evaluated: a.evaluated, rate: a.evaluated > 0 ? a.done / a.evaluated : null }))
}

/** Total completed occurrences (all time) – planned and unplanned. */
export function totalCompleted(index: DataIndex): number {
  let n = 0
  for (const e of index.entries.values()) if (e.value >= (e.target || 1)) n++
  return n
}

export function earliestStart(index: DataIndex, fallback: DateKey): DateKey {
  let min = fallback
  for (const a of index.activities) if (a.startDate < min) min = a.startDate
  return min
}

export function plannedOccurrences(list: Occurrence[]): Occurrence[] {
  return list.filter(isPlanned)
}
