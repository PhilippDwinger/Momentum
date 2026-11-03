import { describe, expect, it } from 'vitest'
import { rangeKeys, weekday } from '../src/domain/dates'
import { buildHistory, computeGame, levelFor, levelThreshold, proposeChallenges, xpByDate } from '../src/domain/gamification'
import { buildWeeklyReview } from '../src/domain/review'
import { suggestRelief } from '../src/domain/scheduling'
import { activityStats, daySummaries, heatLevel, totalsOf, weekdayPattern } from '../src/domain/stats'
import { activity, entry, index } from './helpers'

const MWF = { freq: 'weekly' as const, interval: 1, weekdays: [1, 3, 5] as (1 | 3 | 5)[] }

describe('statistics', () => {
  it('days without anything planned are not failures', () => {
    const a = activity({ startDate: '2026-01-05', rule: MWF })
    const idx = index([a], [entry(a, '2026-01-05'), entry(a, '2026-01-07')])
    const days = daySummaries(idx, '2026-01-05', '2026-01-11', '2026-01-11')
    const t = totalsOf(days.values(), '2026-01-11')
    expect(t.planned).toBe(3)
    expect(t.done).toBe(2)
    expect(t.missed).toBe(1)
    expect(t.rate).toBeCloseTo(2 / 3)
    expect(t.daysWithPlan).toBe(3)
    expect(heatLevel(days.get('2026-01-06'), '2026-01-11')).toBe(0)
    expect(heatLevel(days.get('2026-01-05'), '2026-01-11')).toBe(4)
    expect(heatLevel(days.get('2026-01-09'), '2026-01-11')).toBe(1)
  })

  it("today's open items are not counted as missed; future days are not evaluated", () => {
    const a = activity({ startDate: '2026-01-05' })
    const idx = index([a], [entry(a, '2026-01-05')])
    const days = daySummaries(idx, '2026-01-05', '2026-01-08', '2026-01-06')
    const t = totalsOf(days.values(), '2026-01-06')
    expect(t.evaluated).toBe(1)
    expect(t.rate).toBe(1)
    expect(days.get('2026-01-06')!.open).toBe(1)
    expect(heatLevel(days.get('2026-01-07'), '2026-01-06')).toBe(-1)
  })

  it('gives partial credit in the heatmap but not in the completion rate', () => {
    const a = activity({ startDate: '2026-01-05', kind: 'duration', target: 20 })
    const idx = index([a], [entry(a, '2026-01-05', 10, 20)])
    const days = daySummaries(idx, '2026-01-05', '2026-01-05', '2026-01-06')
    const d = days.get('2026-01-05')!
    expect(d.partial).toBe(1)
    expect(heatLevel(d, '2026-01-06')).toBe(3)
    expect(totalsOf(days.values(), '2026-01-06').rate).toBe(0)
  })

  it('computes per-activity stats and weekday patterns', () => {
    const a = activity({ startDate: '2026-01-05', kind: 'count', target: 10 })
    const entries = rangeKeys('2026-01-05', '2026-01-18').map((d) => entry(a, d, weekday(d) === 1 ? 5 : 10, 10))
    const idx = index([a], entries)
    const s = activityStats(idx, a, '2026-01-05', '2026-01-18')
    expect(s.totals.evaluated).toBe(14)
    expect(s.totals.done).toBe(12)
    expect(s.avgValue).toBeCloseTo((2 * 5 + 12 * 10) / 14)
    const days = daySummaries(idx, '2026-01-05', '2026-01-18', '2026-01-18')
    const pattern = weekdayPattern(days.values(), '2026-01-18')
    expect(pattern[0].rate).toBe(0) // Mondays: only 5 of 10 pages
    expect(pattern[1].rate).toBe(1)
  })
})

describe('gamification', () => {
  it('awards XP only for planned work, capped at the target, plus perfect-day bonus', () => {
    const a = activity({ startDate: '2026-01-05', kind: 'count', target: 10 })
    const idx = index([a], [entry(a, '2026-01-05', 50, 10), entry(a, '2026-01-06', 5, 10)])
    const hist = buildHistory(idx, '2026-01-05', '2026-01-06')
    const xp = xpByDate(hist, '2026-01-06')
    expect(xp.get('2026-01-05')).toBe(10 + 20)
    expect(xp.get('2026-01-06')).toBe(5)
  })

  it('uses a growing level curve', () => {
    expect(levelThreshold(1)).toBe(0)
    expect(levelThreshold(2)).toBe(100)
    expect(levelThreshold(3)).toBe(250)
    expect(levelFor(0).level).toBe(1)
    expect(levelFor(99).level).toBe(1)
    expect(levelFor(100).level).toBe(2)
    expect(levelFor(260).level).toBe(3)
    expect(levelFor(260).intoLevel).toBe(10)
  })

  it('derives achievements from history and loses XP when progress is undone', () => {
    const a = activity({ startDate: '2026-01-05' })
    const entries = rangeKeys('2026-01-05', '2026-01-11').map((d) => entry(a, d))
    const idx = index([a], entries)
    const game = computeGame(idx, buildHistory(idx, '2026-01-05', '2026-01-11'), '2026-01-11')
    const byId = Object.fromEntries(game.achievements.map((x) => [x.id, x]))
    expect(byId.first.unlockedAt).toBe('2026-01-05')
    expect(byId.streak7.unlockedAt).toBe('2026-01-11')
    expect(byId.perfectWeek.unlockedAt).toBe('2026-01-11')
    expect(byId.total30.unlockedAt).toBeNull()
    expect(game.xp).toBe(7 * 30)
    const fewer = index([a], entries.slice(0, 6))
    const g2 = computeGame(fewer, buildHistory(fewer, '2026-01-05', '2026-01-11'), '2026-01-11')
    expect(g2.xp).toBe(6 * 30)
    expect(g2.achievements.find((x) => x.id === 'streak7')!.unlockedAt).toBeNull()
  })

  it('proposes achievable weekly challenges', () => {
    const a = activity({ id: 'jp', startDate: '2026-01-05', rule: MWF })
    const b = activity({ id: 'gym', startDate: '2026-01-05' })
    const idx = index([a, b], [])
    const drafts = proposeChallenges(idx, '2026-01-12', '2026-01-12')
    const completions = drafts.find((d) => d.type === 'completions')!
    expect(completions.goal).toBeLessThanOrEqual(10)
    expect(completions.goal).toBeGreaterThanOrEqual(3)
    expect(drafts.find((d) => d.type === 'perfectDays')!.goal).toBe(3)
  })
})

describe('weekly review and smart scheduling', () => {
  it('summarises a week against the previous one', () => {
    const a = activity({ startDate: '2026-01-05', rule: MWF })
    const entries = ['2026-01-05', '2026-01-12', '2026-01-14', '2026-01-16'].map((d) => entry(a, d))
    const idx = index([a], entries)
    const r = buildWeeklyReview(idx, '2026-01-12', '2026-01-20')
    expect(r.totals.done).toBe(3)
    expect(r.totals.rate).toBe(1)
    expect(r.prevTotals.rate).toBeCloseTo(1 / 3)
    expect(r.rateDelta).toBeCloseTo(2 / 3)
    expect(r.consistent[0].activity.id).toBe(a.id)
    expect(r.missed).toHaveLength(0)
  })

  it('suggests (never applies) a move for overloaded days', () => {
    const acts = Array.from({ length: 7 }, (_, i) =>
      activity({ id: `x${i}`, startDate: '2026-01-05', rule: i < 2 ? { freq: 'daily', interval: 1 } : { freq: 'weekly', interval: 1, weekdays: [3] } }),
    )
    const idx = index(acts, [], [], { overloadThreshold: 5 })
    const relief = suggestRelief(idx, '2026-01-14', '2026-01-12')
    expect(relief).not.toBeNull()
    expect(relief!.to).not.toBe('2026-01-14')
    expect(acts.slice(2).map((a) => a.id)).toContain(relief!.occurrence.activityId)
  })
})
