import { addDays, parseKey } from './dates'
import { isDone, isPlanned, occurrencesOn, type DataIndex } from './occurrences'
import type { StreakInfo } from './streaks'
import type { DateKey, ID, Occurrence } from './types'

export const QUOTE_COUNT = 24

export interface MotivationMessage {
  key: string
  params?: Record<string, string | number>
}

/** Small contextual nudge for the dashboard. Deterministic for a given day and state. */
export function motivationFor(
  index: DataIndex,
  date: DateKey,
  today: DateKey,
  occs: Occurrence[],
  streaks: Map<ID, StreakInfo>,
): MotivationMessage {
  const planned = occs.filter(isPlanned)
  if (date === today) {
    if (planned.length > 0 && planned.every(isDone)) return { key: 'motivation.allDone' }
    let risk: { name: string; n: number } | null = null
    for (const o of planned) {
      if (isDone(o)) continue
      const s = streaks.get(o.activityId)
      const a = index.activityById.get(o.activityId)
      if (a && s && s.current >= 3 && (!risk || s.current > risk.n)) risk = { name: a.name, n: s.current }
    }
    if (risk) return { key: 'motivation.atRisk', params: risk }
    const yesterday = occurrencesOn(index, addDays(today, -1)).filter(isPlanned)
    if (yesterday.length > 0 && yesterday.some((o) => !isDone(o)) && planned.length > 0) return { key: 'motivation.freshStart' }
    if (planned.length === 0) return { key: 'motivation.restDay' }
  }
  const { y, m, d } = parseKey(date)
  const seed = (y * 372 + m * 31 + d) % QUOTE_COUNT
  return { key: `quotes.${seed}` }
}
