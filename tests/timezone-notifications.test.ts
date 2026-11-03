import { describe, expect, it } from 'vitest'
import { logicalToday, resolveTimeZone, zonedParts, zonedTimeToUtc } from '../src/domain/dates'
import { buildNotificationPlan, celebrationText } from '../src/domain/notifications'
import { computeAllStreaks } from '../src/domain/streaks'
import { rangeKeys } from '../src/domain/dates'
import { activity, entry, index } from './helpers'

const helpers = { lang: 'de' as const, amount: (a: { kind: string; unit: string }, v: number) => `${v} ${a.kind === 'duration' ? 'min' : a.unit}` }

describe('time zones', () => {
  it('computes "today" in the configured zone, not the device zone', () => {
    const instant = new Date('2026-11-03T23:30:00Z') // 00:30 in Berlin, 08:30 in Tokyo, 15:30 in LA
    expect(logicalToday(instant, 0, 'Europe/Berlin')).toBe('2026-11-04')
    expect(logicalToday(instant, 0, 'America/Los_Angeles')).toBe('2026-11-03')
    expect(logicalToday(instant, 3, 'Europe/Berlin')).toBe('2026-11-03') // night owl boundary
    expect(zonedParts(instant, 'Asia/Tokyo')).toEqual({ key: '2026-11-04', hour: 8, minute: 30 })
  })
  it('converts wall-clock times to UTC across DST', () => {
    expect(new Date(zonedTimeToUtc('2026-07-01', 9 * 60, 'Europe/Berlin')).toISOString()).toBe('2026-07-01T07:00:00.000Z')
    expect(new Date(zonedTimeToUtc('2026-12-01', 9 * 60, 'Europe/Berlin')).toISOString()).toBe('2026-12-01T08:00:00.000Z')
    // spring gap 02:30 does not exist -> resolves near the jump, never throws
    const gap = zonedTimeToUtc('2026-03-29', 150, 'Europe/Berlin')
    expect(Number.isFinite(gap)).toBe(true)
    expect(new Date(zonedTimeToUtc('2026-11-03', 20 * 60 + 30, 'America/New_York')).toISOString()).toBe('2026-11-04T01:30:00.000Z')
  })
  it('falls back to the device zone for invalid names', () => {
    expect(resolveTimeZone('Mars/Olympus')).toBe(resolveTimeZone(''))
  })
})

describe('notification plan', () => {
  const a = activity({ id: 'jp', name: 'Japanisch', startDate: '2026-10-20', kind: 'duration', target: 15, reminderTime: '19:30' })
  const entries = rangeKeys('2026-10-20', '2026-11-02').map((d) => entry(a, d, 15, 15))

  it('plans reminders, morning and evening pushes with streak-aware texts', () => {
    const idx = index([a], entries, [], { name: 'Paddy', notifyMorning: '07:30', notifyEvening: '20:30', notifyTone: 'intense' })
    const plan = buildNotificationPlan({
      index: idx,
      streaks: computeAllStreaks(idx, '2026-11-03'),
      now: new Date('2026-11-03T06:00:00Z'),
      today: '2026-11-03',
      timeZone: 'Europe/Berlin',
      lang: 'de',
      helpers,
      xpToNext: 500,
      nextLevel: 5,
    })
    const today = plan.filter((p) => p.id.startsWith('2026-11-03'))
    expect(today.map((p) => p.kind)).toEqual(['morning', 'reminder', 'evening'])
    const reminder = today.find((p) => p.kind === 'reminder')!
    expect(new Date(reminder.at).toISOString()).toBe('2026-11-03T18:30:00.000Z')
    expect(reminder.title + reminder.body).toMatch(/Japanisch|Serie|14|15/)
    expect(reminder.occKey).toBe('jp_2026-11-03')
    const evening = today.find((p) => p.kind === 'evening')!
    expect(evening.body).toMatch(/14|Japanisch|offen/)
    // three days, nothing in the past
    expect(plan.every((p) => p.at > new Date('2026-11-03T06:00:00Z').getTime())).toBe(true)
    expect(new Set(plan.map((p) => p.id)).size).toBe(plan.length)
  })

  it('drops the evening rescue once everything is done and is deterministic', () => {
    const done = [...entries, entry(a, '2026-11-03', 15, 15)]
    const idx = index([a], done, [], { notifyEvening: '20:30', notifyMorning: '' })
    const input = {
      index: idx,
      streaks: computeAllStreaks(idx, '2026-11-03'),
      now: new Date('2026-11-03T12:00:00Z'),
      today: '2026-11-03',
      timeZone: 'Europe/Berlin',
      lang: 'de' as const,
      helpers,
      xpToNext: 10,
      nextLevel: 3,
    }
    const plan = buildNotificationPlan(input)
    expect(plan.filter((p) => p.id.startsWith('2026-11-03'))).toHaveLength(0)
    expect(buildNotificationPlan(input)).toEqual(plan)
    // tomorrow's reminder counts on the streak continuing: 15 -> 16
    const tomorrow = plan.find((p) => p.id.startsWith('2026-11-04') && p.kind === 'reminder')!
    expect(tomorrow.title + tomorrow.body).toMatch(/16|15|Japanisch/)
  })

  it('celebrates milestones louder', () => {
    expect(celebrationText('de', 'intense', a, 7, 'x')).toMatch(/7/)
    expect(celebrationText('de', 'intense', a, 7, 'x')).toMatch(/🏆/)
    expect(celebrationText('de', 'gentle', a, 1, 'x')).toMatch(/Japanisch/)
  })
})
