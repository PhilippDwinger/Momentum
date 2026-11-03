import { addDays, parseTime } from './dates'
import { isDone, isPlanned, occurrencesByDate, type DataIndex } from './occurrences'
import type { DateKey, Occurrence } from './types'

/**
 * Smart scheduling – only *suggestions*. Nothing is moved without an explicit user action.
 */

export const OVERLOAD_MINUTES = 240

export interface DayLoad {
  date: DateKey
  count: number
  minutes: number
  overloaded: boolean
}

function minutesOf(index: DataIndex, occ: Occurrence): number {
  const a = index.activityById.get(occ.activityId)
  if (!a) return 0
  if (a.kind === 'duration') return occ.target
  return a.durationMinutes ?? 0
}

export function dayLoad(index: DataIndex, date: DateKey, occs: Occurrence[]): DayLoad {
  const planned = occs.filter(isPlanned)
  const minutes = planned.reduce((sum, o) => sum + minutesOf(index, o), 0)
  const threshold = index.settings.overloadThreshold || 5
  return { date, count: planned.length, minutes, overloaded: planned.length > threshold || minutes > OVERLOAD_MINUTES }
}

export interface Relief {
  occurrence: Occurrence
  to: DateKey
  fromCount: number
  toCount: number
}

/**
 * Suggests moving one open, non-daily occurrence of an overloaded day to the lightest nearby
 * day (±3 days, never into the past) on which that activity is not planned yet.
 */
export function suggestRelief(index: DataIndex, date: DateKey, today: DateKey): Relief | null {
  const from = addDays(date, -3)
  const to = addDays(date, 3)
  const byDate = occurrencesByDate(index, from < today ? today : from, to)
  const occs = byDate.get(date) ?? []
  const load = dayLoad(index, date, occs)
  if (!load.overloaded || date < today) return null

  const candidates = occs
    .filter((o) => isPlanned(o) && !isDone(o))
    .filter((o) => {
      const a = index.activityById.get(o.activityId)
      if (!a) return false
      const rule = a.schedule[a.schedule.length - 1]?.rule
      return !(rule?.freq === 'daily' && rule.interval === 1)
    })
    .sort((x, y) => (parseTime(y.time) ?? 9999) - (parseTime(x.time) ?? 9999))
  if (candidates.length === 0) return null

  let best: Relief | null = null
  for (const occ of candidates) {
    for (let offset = 1; offset <= 3; offset++) {
      for (const d of [addDays(date, offset), addDays(date, -offset)]) {
        if (d < today) continue
        const list = byDate.get(d) ?? []
        if (list.some((o) => o.activityId === occ.activityId)) continue
        const count = list.filter(isPlanned).length
        if (count >= load.count - 1) continue
        if (!best || count < best.toCount) best = { occurrence: occ, to: d, fromCount: load.count, toCount: count }
      }
    }
    if (best) break
  }
  return best
}
