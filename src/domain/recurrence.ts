import {
  addDays,
  daysInMonth,
  diffDays,
  isLastWeekdayInMonth,
  monthsBetween,
  nthInMonth,
  parseKey,
  startOfWeek,
  weekday,
} from './dates'
import type { Activity, DateKey, RecurrenceRule, ScheduleSegment, Weekday } from './types'

/**
 * Recurrence evaluation. Rules are evaluated on demand for a given date – occurrences are
 * never materialised as stored records. The anchor of a rule is the `from` date of its
 * schedule segment.
 */

export function normalizeRule(rule: RecurrenceRule): RecurrenceRule {
  const interval = Math.max(1, Math.min(365, Math.floor(Number(rule.interval) || 1)))
  const out: RecurrenceRule = { freq: rule.freq, interval }
  if (rule.freq === 'weekly') {
    const days = Array.from(new Set((rule.weekdays ?? []).filter((d) => d >= 1 && d <= 7))).sort()
    out.weekdays = days as Weekday[]
  }
  if (rule.freq === 'monthly') {
    out.monthlyMode = rule.monthlyMode === 'weekday' ? 'weekday' : 'day'
    if (out.monthlyMode === 'day' && rule.monthDay) out.monthDay = Math.max(1, Math.min(31, rule.monthDay))
    if (out.monthlyMode === 'weekday') {
      if (rule.nth) out.nth = rule.nth === -1 ? -1 : Math.max(1, Math.min(4, rule.nth))
      if (rule.nthWeekday) out.nthWeekday = rule.nthWeekday
    }
  }
  return out
}

/** Does `rule`, anchored at `anchor`, produce an occurrence on `date`? */
export function matchesRule(rule: RecurrenceRule, anchor: DateKey, date: DateKey): boolean {
  if (date < anchor) return false
  const interval = Math.max(1, Math.floor(rule.interval || 1))
  switch (rule.freq) {
    case 'once':
      return date === anchor
    case 'daily':
      return diffDays(anchor, date) % interval === 0
    case 'weekly': {
      const days = rule.weekdays && rule.weekdays.length > 0 ? rule.weekdays : [weekday(anchor)]
      if (!days.includes(weekday(date))) return false
      if (interval === 1) return true
      const weeks = diffDays(startOfWeek(anchor, 1), startOfWeek(date, 1)) / 7
      return weeks % interval === 0
    }
    case 'monthly': {
      if (monthsBetween(anchor, date) % interval !== 0) return false
      const { y, m, d } = parseKey(date)
      if (rule.monthlyMode === 'weekday') {
        const wd = rule.nthWeekday ?? weekday(anchor)
        const nth = rule.nth ?? (isLastWeekdayInMonth(anchor) && nthInMonth(anchor) > 4 ? -1 : nthInMonth(anchor))
        if (weekday(date) !== wd) return false
        return nth === -1 ? isLastWeekdayInMonth(date) : nthInMonth(date) === nth
      }
      const md = rule.monthDay ?? parseKey(anchor).d
      return d === Math.min(md, daysInMonth(y, m))
    }
    default:
      return false
  }
}

/** The schedule segment that is in effect on `date` (or undefined before the start). */
export function segmentFor(activity: Activity, date: DateKey): ScheduleSegment | undefined {
  let found: ScheduleSegment | undefined
  for (const seg of activity.schedule) {
    if (seg.from <= date) found = seg
    else break
  }
  return found
}

/**
 * Does the activity's *plan* contain an occurrence originally dated `date`? Considers start/end,
 * pauses and schedule segments – but not the archive cutoff, which applies to the effective
 * (possibly moved) date of an occurrence. See `isScheduled` for the combined check.
 */
export function ruleScheduled(activity: Activity, date: DateKey): boolean {
  if (activity.deletedAt) return false
  if (date < activity.startDate) return false
  if (activity.endDate && date > activity.endDate) return false
  if (activity.pauses?.some((p) => date >= p.from && date <= p.to)) return false
  const seg = segmentFor(activity, date)
  if (!seg) return false
  return matchesRule(seg.rule, seg.anchor ?? seg.from, date)
}

/** True when an occurrence originally on `date` is active on that same date (not archived). */
export function isActiveOn(activity: Activity, date: DateKey): boolean {
  return !activity.archivedAt || date < activity.archivedAt
}

/** Plan + archive check for an unmoved occurrence on `date`. */
export function isScheduled(activity: Activity, date: DateKey): boolean {
  return ruleScheduled(activity, date) && isActiveOn(activity, date)
}

export function targetFor(activity: Activity, date: DateKey): number {
  if (activity.kind === 'check') return 1
  return segmentFor(activity, date)?.target ?? activity.schedule[0]?.target ?? 1
}

/** Scheduled dates in [from, to] (rule-based, without overrides). */
/** Original dates in [from, to] that are part of the plan (ignores archive and overrides). */
export function scheduledDates(activity: Activity, from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  let d = from < activity.startDate ? activity.startDate : from
  const last = activity.endDate && activity.endDate < to ? activity.endDate : to
  // `once` short-circuit avoids scanning long ranges.
  if (activity.schedule.length === 1 && activity.schedule[0].rule.freq === 'once') {
    const only = activity.schedule[0].from
    return only >= d && only <= last && ruleScheduled(activity, only) ? [only] : []
  }
  while (d <= last) {
    if (ruleScheduled(activity, d)) out.push(d)
    d = addDays(d, 1)
  }
  return out
}

/** The next `count` scheduled dates on or after `from` (searches up to ~3 years). */
export function nextScheduledDates(activity: Activity, from: DateKey, count: number): DateKey[] {
  const out: DateKey[] = []
  let d = from < activity.startDate ? activity.startDate : from
  for (let i = 0; i < 1100 && out.length < count; i++) {
    if (activity.endDate && d > activity.endDate) break
    if (isScheduled(activity, d)) out.push(d)
    d = addDays(d, 1)
  }
  return out
}

/** True when the activity has only a single one-time occurrence. */
export function isOneTime(activity: Activity): boolean {
  return activity.schedule.length > 0 && activity.schedule.every((s) => s.rule.freq === 'once')
}

/**
 * Returns a new schedule where `rule`/`target` apply from `from` onward
 * ("edit this and future occurrences"). Segments starting on/after `from` are replaced,
 * earlier ones are kept untouched – history is never rewritten.
 */
export function scheduleWithChangeFrom(
  schedule: ScheduleSegment[],
  from: DateKey,
  rule: RecurrenceRule,
  target: number,
): ScheduleSegment[] {
  const kept = schedule.filter((s) => s.from < from)
  const norm = normalizeRule(rule)
  const next: ScheduleSegment = { from, rule: norm, target }
  const prev = kept[kept.length - 1]
  if (prev) {
    // Same rhythm -> keep the alignment of interval rules (biweekly, every n days/months).
    if (norm.freq !== 'once' && prev.rule.freq === norm.freq && prev.rule.interval === norm.interval) {
      const anchor = prev.anchor ?? prev.from
      if (anchor !== from) next.anchor = anchor
    }
    // Nothing changed at all -> no new segment.
    if (prev.target === target && JSON.stringify(prev.rule) === JSON.stringify(norm) && norm.freq !== 'once') return kept
  }
  return [...kept, next]
}
