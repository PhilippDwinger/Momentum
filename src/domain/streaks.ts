import { diffDays } from './dates'
import { activityOccurrences, countsAsSuccess, firstDateOf, type DataIndex } from './occurrences'
import type { Activity, DateKey } from './types'

/**
 * Streaks count *consecutive scheduled occurrences* that were completed – not calendar days.
 * Rest days / unscheduled days are invisible to the streak. Skipped occurrences are neutral.
 * Today's still-open occurrence never breaks a streak. Future occurrences are ignored.
 *
 * Streak protection (optional, transparent): one missed occurrence per activity within any
 * 7-day window is forgiven while a streak is running – and only if there was a success since
 * the last forgiven miss (so weekly habits cannot be carried by protection alone). The
 * forgiven occurrence does not add to the streak, it only prevents the reset.
 */

export interface StreakInfo {
  current: number
  longest: number
  /** Dates of missed occurrences that were forgiven by streak protection (all time). */
  protectedDates: DateKey[]
  /** Forgiven misses inside the currently running streak. */
  currentProtected: DateKey[]
  /** Today's occurrence is still open and a streak is running. */
  atRisk: boolean
  /** Streak would also grow today (today scheduled and not yet completed). */
  dueToday: boolean
  lastSuccess: DateKey | null
  /** First date on which the running streak reached each milestone (e.g. 7, 30). */
  milestones: Record<number, DateKey>
  /** Completed (counting) occurrences in total. */
  totalSuccess: number
}

export const STREAK_MILESTONES = [3, 7, 14, 30, 50, 100]

export function computeStreak(index: DataIndex, activity: Activity, today: DateKey): StreakInfo {
  const occs = activityOccurrences(index, activity, firstDateOf(index, activity), today)
  const protection = index.settings.streakProtection
  let current = 0
  let longest = 0
  let lastProtected: DateKey | null = null
  let lastSuccess: DateKey | null = null
  let dueToday = false
  let successSinceProtect = true
  let totalSuccess = 0
  const protectedDates: DateKey[] = []
  let currentProtected: DateKey[] = []
  const milestones: Record<number, DateKey> = {}

  for (const occ of occs) {
    if (occ.skipped || occ.unplanned) continue
    if (countsAsSuccess(occ, activity)) {
      current++
      totalSuccess++
      successSinceProtect = true
      lastSuccess = occ.date
      if (current > longest) longest = current
      for (const m of STREAK_MILESTONES) if (current >= m && !milestones[m]) milestones[m] = occ.date
      continue
    }
    if (occ.date >= today) {
      // still open today – neither counted nor broken
      dueToday = true
      continue
    }
    // missed (or partial that does not count)
    if (protection && current > 0 && successSinceProtect && (lastProtected === null || diffDays(lastProtected, occ.date) >= 7)) {
      lastProtected = occ.date
      successSinceProtect = false
      protectedDates.push(occ.date)
      currentProtected.push(occ.date)
      continue
    }
    current = 0
    currentProtected = []
  }
  const atRisk = dueToday && current > 0
  return { current, longest, protectedDates, currentProtected, atRisk, dueToday, lastSuccess, milestones, totalSuccess }
}

export function computeAllStreaks(index: DataIndex, today: DateKey): Map<string, StreakInfo> {
  const map = new Map<string, StreakInfo>()
  for (const a of index.activities) map.set(a.id, computeStreak(index, a, today))
  return map
}
