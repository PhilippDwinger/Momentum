import { describe, expect, it } from 'vitest'
import { addDays, rangeKeys } from '../src/domain/dates'
import { computeStreak } from '../src/domain/streaks'
import { scheduleWithChangeFrom } from '../src/domain/recurrence'
import { activity, entry, index, override } from './helpers'

const MWF = { freq: 'weekly' as const, interval: 1, weekdays: [1, 3, 5] as (1 | 3 | 5)[] }

describe('streaks', () => {
  it('counts consecutive completed occurrences of a daily habit', () => {
    const a = activity({ startDate: '2026-01-05' })
    const entries = rangeKeys('2026-01-05', '2026-01-11').map((d) => entry(a, d))
    const s = computeStreak(index([a], entries), a, '2026-01-11')
    expect(s.current).toBe(7)
    expect(s.longest).toBe(7)
    expect(s.milestones[7]).toBe('2026-01-11')
  })

  it('rest days and unscheduled days do not break a streak', () => {
    const a = activity({ startDate: '2026-01-05', rule: MWF })
    const entries = ['2026-01-05', '2026-01-07', '2026-01-09', '2026-01-12'].map((d) => entry(a, d))
    const s = computeStreak(index([a], entries), a, '2026-01-13') // Tuesday – rest day
    expect(s.current).toBe(4)
  })

  it('a missed scheduled occurrence breaks the streak', () => {
    const a = activity({ startDate: '2026-01-05', rule: MWF })
    const entries = ['2026-01-05', '2026-01-09', '2026-01-12'].map((d) => entry(a, d)) // missed Wed 7th
    const s = computeStreak(index([a], entries), a, '2026-01-13')
    expect(s.current).toBe(2)
    expect(s.longest).toBe(2)
  })

  it("today's open occurrence does not break the streak and is marked at risk", () => {
    const a = activity({ startDate: '2026-01-05' })
    const entries = rangeKeys('2026-01-05', '2026-01-09').map((d) => entry(a, d))
    const s = computeStreak(index([a], entries), a, '2026-01-10')
    expect(s.current).toBe(5)
    expect(s.atRisk).toBe(true)
  })

  it('completing today updates the streak immediately', () => {
    const a = activity({ startDate: '2026-01-05' })
    const entries = rangeKeys('2026-01-05', '2026-01-10').map((d) => entry(a, d))
    expect(computeStreak(index([a], entries), a, '2026-01-10').current).toBe(6)
  })

  it('gives no credit for future entries', () => {
    const a = activity({ startDate: '2026-01-05' })
    const entries = [entry(a, '2026-01-05'), entry(a, '2026-01-06'), entry(a, '2026-01-07')]
    const s = computeStreak(index([a], entries), a, '2026-01-06')
    expect(s.current).toBe(2)
    expect(s.totalSuccess).toBe(2)
  })

  it('skipped occurrences are neutral', () => {
    const a = activity({ startDate: '2026-01-05' })
    const entries = ['2026-01-05', '2026-01-07'].map((d) => entry(a, d))
    const s = computeStreak(index([a], entries, [override(a, '2026-01-06', { skipped: true })]), a, '2026-01-07')
    expect(s.current).toBe(2)
  })

  it('a moved occurrence counts at its new date', () => {
    const a = activity({ startDate: '2026-01-05', rule: MWF })
    // Wed moved to Thu and done on Thu
    const idx = index(
      [a],
      [entry(a, '2026-01-05'), entry(a, '2026-01-07'), entry(a, '2026-01-09')],
      [override(a, '2026-01-07', { movedTo: '2026-01-08' })],
    )
    expect(computeStreak(idx, a, '2026-01-09').current).toBe(3)
  })

  it('a missed occurrence moved to the future is not counted as missed', () => {
    const a = activity({ startDate: '2026-01-05' })
    const idx = index([a], [entry(a, '2026-01-05'), entry(a, '2026-01-07')], [override(a, '2026-01-06', { movedTo: '2026-01-09' })])
    expect(computeStreak(idx, a, '2026-01-07').current).toBe(2)
  })

  it('partial progress counts only when the activity allows it', () => {
    const strict = activity({ id: 'strict', kind: 'duration', target: 20, startDate: '2026-01-05' })
    const lenient = activity({ id: 'lenient', kind: 'duration', target: 20, startDate: '2026-01-05', partialCounts: true })
    const mk = (a: typeof strict) => [entry(a, '2026-01-05', 20, 20), entry(a, '2026-01-06', 10, 20), entry(a, '2026-01-07', 20, 20)]
    const idx = index([strict, lenient], [...mk(strict), ...mk(lenient)])
    expect(computeStreak(idx, strict, '2026-01-07').current).toBe(1)
    expect(computeStreak(idx, lenient, '2026-01-07').current).toBe(3)
  })

  it('streak protection forgives one miss per 7 days, transparently', () => {
    const a = activity({ startDate: '2026-01-05' })
    const done = rangeKeys('2026-01-05', '2026-01-20').filter((d) => d !== '2026-01-08' && d !== '2026-01-11')
    const idx = index([a], done.map((d) => entry(a, d)), [], { streakProtection: true })
    const s = computeStreak(idx, a, '2026-01-20')
    // 8th forgiven, 11th is within 7 days of the 8th -> breaks; 12th..20th = 9
    expect(s.protectedDates).toEqual(['2026-01-08'])
    expect(s.current).toBe(9)
    const off = computeStreak(index([a], done.map((d) => entry(a, d))), a, '2026-01-20')
    expect(off.current).toBe(9)
    expect(off.protectedDates).toEqual([])
    // with protection the first run is 3 + 2 = 5 long instead of 3
    const early = computeStreak(idx, a, '2026-01-10')
    expect(early.current).toBe(5)
  })

  it('changing the recurrence from a date keeps historical streak data', () => {
    const a = activity({ startDate: '2026-01-05' })
    const entries = rangeKeys('2026-01-05', '2026-01-11').map((d) => entry(a, d))
    const changed = { ...a, schedule: scheduleWithChangeFrom(a.schedule, '2026-01-12', MWF, 1) }
    const more = ['2026-01-12', '2026-01-14'].map((d) => entry(a, d))
    const s = computeStreak(index([changed], [...entries, ...more]), changed, '2026-01-15') // Thu – rest day now
    expect(s.current).toBe(9)
  })

  it('handles long histories quickly', () => {
    const a = activity({ startDate: '2023-01-01' })
    const entries = rangeKeys('2023-01-01', '2026-01-01').map((d) => entry(a, d))
    const t0 = performance.now()
    const s = computeStreak(index([a], entries), a, '2026-01-01')
    expect(s.current).toBe(entries.length)
    expect(performance.now() - t0).toBeLessThan(500)
    expect(addDays('2023-01-01', entries.length - 1)).toBe('2026-01-01')
  })
})
