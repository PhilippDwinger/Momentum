import { describe, expect, it } from 'vitest'
import { addDays, addMonths, diffDays, isoWeek, logicalToday, rangeKeys, startOfWeek, weekday } from '../src/domain/dates'
import { isScheduled, matchesRule, nextScheduledDates, scheduleWithChangeFrom, scheduledDates } from '../src/domain/recurrence'
import { activityOccurrences, occurrencesOn } from '../src/domain/occurrences'
import { activity, entry, index, override } from './helpers'

describe('dates', () => {
  it('does day arithmetic independent of DST transitions', () => {
    // Europe: DST ends 2026-10-25, starts 2026-03-29
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-03-28', 2)).toBe('2026-03-30')
    expect(diffDays('2026-03-01', '2026-04-01')).toBe(31)
    expect(rangeKeys('2026-10-24', '2026-10-27')).toHaveLength(4)
  })
  it('computes weekdays, week starts and ISO weeks', () => {
    expect(weekday('2026-01-05')).toBe(1)
    expect(weekday('2026-01-11')).toBe(7)
    expect(startOfWeek('2026-01-11', 1)).toBe('2026-01-05')
    expect(startOfWeek('2026-01-11', 0)).toBe('2026-01-11')
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1 })
    expect(isoWeek('2027-01-01')).toEqual({ year: 2026, week: 53 })
  })
  it('clamps month arithmetic', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
  })
  it('respects a configurable day boundary', () => {
    expect(logicalToday(new Date(2026, 10, 3, 2, 30), 4)).toBe('2026-11-02')
    expect(logicalToday(new Date(2026, 10, 3, 4, 0), 4)).toBe('2026-11-03')
    expect(logicalToday(new Date(2026, 10, 3, 0, 5), 0)).toBe('2026-11-03')
  })
})

describe('recurrence rules', () => {
  const anchor = '2026-01-05' // Monday
  it('daily and every X days', () => {
    expect(matchesRule({ freq: 'daily', interval: 1 }, anchor, '2026-02-17')).toBe(true)
    expect(matchesRule({ freq: 'daily', interval: 3 }, anchor, '2026-01-08')).toBe(true)
    expect(matchesRule({ freq: 'daily', interval: 3 }, anchor, '2026-01-09')).toBe(false)
    expect(matchesRule({ freq: 'daily', interval: 1 }, anchor, '2026-01-04')).toBe(false)
  })
  it('specific weekdays (Japanese on Mon/Wed/Fri)', () => {
    const rule = { freq: 'weekly' as const, interval: 1, weekdays: [1, 3, 5] as (1 | 3 | 5)[] }
    const days = rangeKeys('2026-01-05', '2026-01-18').filter((d) => matchesRule(rule, anchor, d))
    expect(days).toEqual(['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12', '2026-01-14', '2026-01-16'])
  })
  it('every weekday', () => {
    const rule = { freq: 'weekly' as const, interval: 1, weekdays: [1, 2, 3, 4, 5] as (1 | 2 | 3 | 4 | 5)[] }
    expect(rangeKeys('2026-01-05', '2026-01-11').filter((d) => matchesRule(rule, anchor, d))).toHaveLength(5)
  })
  it('every two weeks anchored at the start week', () => {
    const rule = { freq: 'weekly' as const, interval: 2, weekdays: [2] as 2[] }
    const days = rangeKeys('2026-01-05', '2026-02-08').filter((d) => matchesRule(rule, anchor, d))
    expect(days).toEqual(['2026-01-06', '2026-01-20', '2026-02-03'])
  })
  it('weekly without explicit days uses the anchor weekday', () => {
    expect(matchesRule({ freq: 'weekly', interval: 1 }, anchor, '2026-01-12')).toBe(true)
    expect(matchesRule({ freq: 'weekly', interval: 1 }, anchor, '2026-01-13')).toBe(false)
  })
  it('monthly by day clamps to short months', () => {
    const rule = { freq: 'monthly' as const, interval: 1, monthlyMode: 'day' as const, monthDay: 31 }
    expect(matchesRule(rule, '2026-01-31', '2026-02-28')).toBe(true)
    expect(matchesRule(rule, '2026-01-31', '2026-04-30')).toBe(true)
    expect(matchesRule(rule, '2026-01-31', '2026-04-29')).toBe(false)
  })
  it('monthly by nth / last weekday and interval', () => {
    const second = { freq: 'monthly' as const, interval: 1, monthlyMode: 'weekday' as const, nth: 2, nthWeekday: 2 as const }
    expect(matchesRule(second, '2026-01-01', '2026-02-10')).toBe(true) // 2nd Tuesday Feb 2026
    expect(matchesRule(second, '2026-01-01', '2026-02-03')).toBe(false)
    const last = { freq: 'monthly' as const, interval: 1, monthlyMode: 'weekday' as const, nth: -1, nthWeekday: 5 as const }
    expect(matchesRule(last, '2026-01-01', '2026-01-30')).toBe(true)
    expect(matchesRule(last, '2026-01-01', '2026-01-23')).toBe(false)
    const quarterly = { freq: 'monthly' as const, interval: 3, monthlyMode: 'day' as const, monthDay: 1 }
    expect(matchesRule(quarterly, '2026-01-01', '2026-04-01')).toBe(true)
    expect(matchesRule(quarterly, '2026-01-01', '2026-03-01')).toBe(false)
  })
  it('one-time activities occur exactly once', () => {
    const a = activity({ startDate: '2026-03-10', rule: { freq: 'once', interval: 1 } })
    expect(scheduledDates(a, '2026-01-01', '2026-12-31')).toEqual(['2026-03-10'])
  })
})

describe('activity schedules', () => {
  it('honours start, end, archive and pauses', () => {
    const a = activity({ startDate: '2026-01-05', endDate: '2026-01-20', archivedAt: '2026-01-15', pauses: [{ from: '2026-01-08', to: '2026-01-09' }] })
    expect(isScheduled(a, '2026-01-04')).toBe(false)
    expect(isScheduled(a, '2026-01-07')).toBe(true)
    expect(isScheduled(a, '2026-01-08')).toBe(false)
    expect(isScheduled(a, '2026-01-14')).toBe(true)
    expect(isScheduled(a, '2026-01-15')).toBe(false)
  })
  it('"this and future" adds a segment without rewriting the past', () => {
    const a = activity({ startDate: '2026-01-05', rule: { freq: 'daily', interval: 1 } })
    const schedule = scheduleWithChangeFrom(a.schedule, '2026-01-12', { freq: 'weekly', interval: 1, weekdays: [1, 3] }, 1)
    const b = { ...a, schedule }
    expect(schedule).toHaveLength(2)
    expect(isScheduled(b, '2026-01-10')).toBe(true) // Saturday, still daily
    expect(isScheduled(b, '2026-01-13')).toBe(false) // Tuesday, new rule
    expect(isScheduled(b, '2026-01-14')).toBe(true)
    // replacing from the same date again replaces the segment, not stacks it
    expect(scheduleWithChangeFrom(schedule, '2026-01-12', { freq: 'daily', interval: 2 }, 1)).toHaveLength(2)
  })
  it('previews the next occurrences', () => {
    const a = activity({ startDate: '2026-01-05', rule: { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] } })
    expect(nextScheduledDates(a, '2026-01-06', 3)).toEqual(['2026-01-07', '2026-01-09', '2026-01-12'])
  })
})

describe('occurrences with exceptions', () => {
  it('moves a single occurrence without touching the series', () => {
    const a = activity({ startDate: '2026-01-05', rule: { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] } })
    const idx = index([a], [], [override(a, '2026-01-07', { movedTo: '2026-01-08' })])
    expect(occurrencesOn(idx, '2026-01-07')).toHaveLength(0)
    const moved = occurrencesOn(idx, '2026-01-08')
    expect(moved).toHaveLength(1)
    expect(moved[0]).toMatchObject({ originalDate: '2026-01-07', moved: true })
    expect(occurrencesOn(idx, '2026-01-09')).toHaveLength(1)
  })
  it('includes occurrences moved in from outside the range', () => {
    const a = activity({ startDate: '2026-01-05', rule: { freq: 'weekly', interval: 1, weekdays: [1] } })
    const idx = index([a], [], [override(a, '2026-01-05', { movedTo: '2026-02-20' })])
    const occs = activityOccurrences(idx, a, '2026-02-01', '2026-02-28')
    expect(occs.map((o) => o.date)).toEqual(['2026-02-02', '2026-02-09', '2026-02-16', '2026-02-20', '2026-02-23'])
  })
  it('keeps progress visible when the schedule no longer contains the date', () => {
    const a = activity({ startDate: '2026-01-05', rule: { freq: 'weekly', interval: 1, weekdays: [2] } })
    const idx = index([a], [entry(a, '2026-01-05')])
    const occs = occurrencesOn(idx, '2026-01-05')
    expect(occs).toHaveLength(1)
    expect(occs[0].unplanned).toBe(true)
  })
  it('marks skipped occurrences', () => {
    const a = activity()
    const idx = index([a], [], [override(a, '2026-01-06', { skipped: true })])
    expect(occurrencesOn(idx, '2026-01-06')[0].skipped).toBe(true)
  })
})
