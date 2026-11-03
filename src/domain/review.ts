import { addDays, rangeKeys, weekday } from './dates'
import { isDone, isPlanned, occurrencesByDate, type DataIndex } from './occurrences'
import { isPerfectDay } from './gamification'
import { summarizeDay, totalsOf, type Totals } from './stats'
import type { Activity, DateKey, Occurrence } from './types'

/**
 * Deterministic weekly review – plain calculations over stored data, no AI service.
 * The UI turns this structure into sentences via i18n templates.
 */

export interface ActivityWeek {
  activity: Activity
  planned: number
  done: number
  rate: number | null
  /** Average rate of the three previous weeks (null if no data). */
  prevAvg: number | null
  missedDates: DateKey[]
}

export interface WeeklyReview {
  week: DateKey
  weekEnd: DateKey
  isCurrent: boolean
  hasData: boolean
  totals: Totals
  prevTotals: Totals
  rateDelta: number | null
  doneDelta: number
  perfectDays: DateKey[]
  activities: ActivityWeek[]
  consistent: ActivityWeek[]
  missed: ActivityWeek[]
  improving: ActivityWeek[]
  declining: ActivityWeek[]
  bestWeekday: number | null
  focus: { kind: 'reduce' | 'restart' | 'keep'; activity: Activity } | null
}

function rateOf(occs: Occurrence[]): { planned: number; done: number; rate: number | null } {
  const planned = occs.filter(isPlanned)
  const done = planned.filter(isDone).length
  return { planned: planned.length, done, rate: planned.length ? done / planned.length : null }
}

export function buildWeeklyReview(index: DataIndex, week: DateKey, today: DateKey): WeeklyReview {
  const weekEnd = addDays(week, 6)
  const evalEnd = weekEnd < today ? weekEnd : today
  const histFrom = addDays(week, -21)
  const byDate = occurrencesByDate(index, histFrom, evalEnd)

  const days = (from: DateKey, to: DateKey) =>
    to < from ? [] : rangeKeys(from, to).map((d) => summarizeDay(d, byDate.get(d) ?? [], today))
  const totals = totalsOf(days(week, evalEnd), today)
  const prevTotals = totalsOf(days(addDays(week, -7), addDays(week, -1)), today)

  const occsIn = (from: DateKey, to: DateKey, filter?: (o: Occurrence) => boolean) => {
    const out: Occurrence[] = []
    if (to < from) return out
    for (const d of rangeKeys(from, to)) for (const o of byDate.get(d) ?? []) if (!filter || filter(o)) out.push(o)
    return out
  }
  // judged occurrences: past days fully, today only if done
  const judged = (o: Occurrence) => o.date < today || isDone(o)

  const activities: ActivityWeek[] = []
  for (const a of index.activities) {
    const cur = occsIn(week, evalEnd, (o) => o.activityId === a.id && judged(o))
    const r = rateOf(cur)
    if (r.planned === 0) continue
    const prevRates: number[] = []
    for (let i = 1; i <= 3; i++) {
      const ws = addDays(week, -7 * i)
      const pr = rateOf(occsIn(ws, addDays(ws, 6), (o) => o.activityId === a.id))
      if (pr.rate !== null) prevRates.push(pr.rate)
    }
    activities.push({
      activity: a,
      planned: r.planned,
      done: r.done,
      rate: r.rate,
      prevAvg: prevRates.length ? prevRates.reduce((x, y) => x + y, 0) / prevRates.length : null,
      missedDates: cur.filter((o) => isPlanned(o) && !isDone(o) && o.date < today).map((o) => o.date),
    })
  }

  const perfectDays = rangeKeys(week, evalEnd < week ? week : evalEnd).filter((d) => d <= today && isPerfectDay(byDate.get(d) ?? []))
  const consistent = activities
    .filter((x) => (x.rate ?? 0) >= 0.6 && x.planned >= 2)
    .sort((x, y) => (y.rate ?? 0) - (x.rate ?? 0) || y.done - x.done)
    .slice(0, 3)
  const missed = activities.filter((x) => x.missedDates.length > 0).sort((x, y) => y.missedDates.length - x.missedDates.length)
  const improving = activities.filter((x) => x.prevAvg !== null && x.rate !== null && x.planned >= 2 && x.rate - x.prevAvg >= 0.15)
  const declining = activities.filter((x) => x.prevAvg !== null && x.rate !== null && x.planned >= 2 && x.prevAvg - x.rate >= 0.25)

  // weekday with the most completions
  const perWeekday = new Map<number, number>()
  for (const o of occsIn(week, evalEnd)) if (isPlanned(o) && isDone(o)) perWeekday.set(weekday(o.date), (perWeekday.get(weekday(o.date)) ?? 0) + 1)
  let bestWeekday: number | null = null
  for (const [wd, n] of perWeekday) if (bestWeekday === null || n > (perWeekday.get(bestWeekday) ?? 0)) bestWeekday = wd

  // one gentle focus suggestion for next week
  let focus: WeeklyReview['focus'] = null
  const struggling = activities
    .filter((x) => x.rate !== null && x.rate < 0.5 && x.planned >= 3 && (x.prevAvg === null || x.prevAvg < 0.5))
    .sort((x, y) => (x.rate ?? 0) - (y.rate ?? 0))[0]
  if (struggling) focus = { kind: 'reduce', activity: struggling.activity }
  else if (declining[0]) focus = { kind: 'restart', activity: declining[0].activity }
  else if (consistent[0]) focus = { kind: 'keep', activity: consistent[0].activity }

  return {
    week,
    weekEnd,
    isCurrent: week <= today && today <= weekEnd,
    hasData: totals.evaluated > 0 || activities.length > 0,
    totals,
    prevTotals,
    rateDelta: totals.rate !== null && prevTotals.rate !== null ? totals.rate - prevTotals.rate : null,
    doneDelta: totals.done - prevTotals.done,
    perfectDays,
    activities,
    consistent,
    missed,
    improving,
    declining,
    bestWeekday,
    focus,
  }
}
