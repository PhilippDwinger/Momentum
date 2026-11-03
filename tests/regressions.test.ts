/**
 * Regression tests for issues found in an independent review of the domain/data layer.
 */
import { describe, expect, it } from 'vitest'
import * as actions from '../src/data/actions'
import { LocalRepository } from '../src/data/repository'
import { applyRemoteRecords } from '../src/sync/merge'
import { parseImport } from '../src/data/importParse'
import { buildExport } from '../src/data/exportImport'
import { DEFAULT_SETTINGS } from '../src/data/defaults'
import { buildIndex, occurrencesOn } from '../src/domain/occurrences'
import { nextScheduledDates, scheduleWithChangeFrom } from '../src/domain/recurrence'
import { computeStreak } from '../src/domain/streaks'
import { activityStats } from '../src/domain/stats'
import type { Activity, Category, UserSettings } from '../src/domain/types'
import type { DataSnapshot } from '../src/domain/occurrences'
import { activity, entry, index, override } from './helpers'

let n = 0
const openRepo = () => LocalRepository.open(`reg-${Date.now()}-${++n}`)
async function snap(repo: LocalRepository): Promise<DataSnapshot> {
  const db = repo.db
  return {
    activities: await db.activities.toArray(),
    categories: await db.categories.toArray(),
    entries: await db.entries.toArray(),
    overrides: await db.overrides.toArray(),
    challenges: await db.challenges.toArray(),
    settings: ((await db.settings.get('settings')) as UserSettings | undefined) ?? DEFAULT_SETTINGS,
  }
}

describe('review regressions', () => {
  it('editing only the name keeps all schedule segments ("keep" scope)', async () => {
    const repo = await openRepo()
    actions.setRepository(repo)
    const a = await actions.createActivity({
      name: 'A', description: '', icon: 'i:code', color: 'blue', categoryId: null, kind: 'check', unit: '',
      startDate: '2026-01-05', endDate: null, rule: { freq: 'daily', interval: 1 }, target: 1, time: null,
      durationMinutes: null, reminderTime: null, partialCounts: false, notes: '',
    })
    const split = await actions.updateActivity(a, { ...a, rule: { freq: 'weekly', interval: 1, weekdays: [1] }, target: 1 }, { mode: 'from', from: '2026-06-01' })
    expect(split.schedule).toHaveLength(2)
    const renamed = await actions.updateActivity(split, { ...split, name: 'B', rule: split.schedule[1].rule, target: 1 }, { mode: 'keep' })
    expect(renamed.name).toBe('B')
    expect(renamed.schedule).toEqual(split.schedule)
  })

  it('seeded categories never overwrite user edits during merge/sync', async () => {
    const a = await openRepo()
    actions.setRepository(a)
    await actions.ensureSeeded()
    expect(await a.db.changes.count()).toBe(0) // seeds are not queued for sync
    await a.patch<Category>('categories', 'cat_health', { name: 'Body & Mind', color: 'pink' })
    const exported = parseImport(await buildExport())
    const b = await openRepo()
    actions.setRepository(b)
    await actions.ensureSeeded()
    await applyRemoteRecords(b, exported.records)
    const cat = await b.db.categories.get('cat_health')
    expect(cat!.name).toBe('Body & Mind')
    // and the other direction: b's seeds cannot win over a's edit
    actions.setRepository(b)
    const fromB = parseImport(await buildExport())
    await applyRemoteRecords(a, fromB.records)
    expect((await a.db.categories.get('cat_health'))!.name).toBe('Body & Mind')
  })

  it('streak protection cannot carry a weekly habit through consecutive misses', () => {
    const a = activity({ startDate: '2026-01-05', rule: { freq: 'weekly', interval: 1, weekdays: [1] } })
    const idx = index([a], [entry(a, '2026-01-05'), entry(a, '2026-01-12')], [], { streakProtection: true })
    const s = computeStreak(idx, a, '2026-03-02')
    expect(s.current).toBe(0)
    expect(s.protectedDates).toEqual(['2026-01-19'])
  })

  it('"this and future" keeps the rhythm of interval rules', () => {
    const biweekly = activity({ startDate: '2026-10-26', rule: { freq: 'weekly', interval: 2, weekdays: [1] }, kind: 'count', target: 10 })
    const changed = { ...biweekly, schedule: scheduleWithChangeFrom(biweekly.schedule, '2026-11-03', { freq: 'weekly', interval: 2, weekdays: [1] }, 20) }
    expect(nextScheduledDates(changed, '2026-11-03', 2)).toEqual(['2026-11-09', '2026-11-23'])
    const every3 = activity({ startDate: '2026-11-01', rule: { freq: 'daily', interval: 3 }, kind: 'count', target: 5 })
    const c3 = { ...every3, schedule: scheduleWithChangeFrom(every3.schedule, '2026-11-03', { freq: 'daily', interval: 3 }, 8) }
    expect(nextScheduledDates(c3, '2026-11-03', 3)).toEqual(['2026-11-04', '2026-11-07', '2026-11-10'])
    const monthly = activity({ startDate: '2026-01-31', rule: { freq: 'monthly', interval: 1, monthlyMode: 'day', monthDay: 31 } })
    const cm = { ...monthly, schedule: scheduleWithChangeFrom(monthly.schedule, '2026-04-30', { freq: 'monthly', interval: 1, monthlyMode: 'day', monthDay: 31 }, 1) }
    expect(nextScheduledDates(cm, '2026-05-01', 2)).toEqual(['2026-05-31', '2026-06-30'])
  })

  it('logged progress keeps its target snapshot when the series target changes', () => {
    const a = activity({ startDate: '2026-01-05', kind: 'count', target: 10 })
    const raised: Activity = { ...a, schedule: [{ ...a.schedule[0], target: 20 }] }
    const idx = index([raised], [entry(raised, '2026-01-05', 10, 10)])
    expect(occurrencesOn(idx, '2026-01-05')[0].target).toBe(10)
    expect(computeStreak(idx, raised, '2026-01-05').current).toBe(1)
    expect(occurrencesOn(idx, '2026-01-06')[0].target).toBe(20)
  })

  it('archive cutoff follows the effective date of moved occurrences', () => {
    const a = activity({ id: 'arch', startDate: '2026-10-26', rule: { freq: 'weekly', interval: 1, weekdays: [1, 3] }, archivedAt: '2026-11-03' })
    // Wed 11-04 moved to Tue 11-03 and done; Mon 11-02 moved to 11-20
    const idx = index([a], [entry(a, '2026-11-04')], [override(a, '2026-11-04', { movedTo: '2026-11-02' }), override(a, '2026-10-26', { movedTo: '2026-11-20' })])
    expect(occurrencesOn(idx, '2026-11-02').map((o) => o.originalDate)).toEqual(['2026-11-02', '2026-11-04'])
    expect(occurrencesOn(idx, '2026-11-20')).toHaveLength(0)
  })

  it('occurrences moved before the start date still count', () => {
    const a = activity({ startDate: '2026-11-01', rule: { freq: 'once', interval: 1 } })
    const idx = index([a], [entry(a, '2026-11-01')], [override(a, '2026-11-01', { movedTo: '2026-10-31' })])
    expect(computeStreak(idx, a, '2026-11-03').current).toBe(1)
    expect(activityStats(idx, a, '2026-10-01', '2026-11-03').totals.done).toBe(1)
  })

  it('import rejects records with invalid versions', async () => {
    const repo = await openRepo()
    actions.setRepository(repo)
    await actions.createActivity({
      name: 'X', description: '', icon: 'i:code', color: 'blue', categoryId: null, kind: 'check', unit: '',
      startDate: '2026-01-05', endDate: null, rule: { freq: 'daily', interval: 1 }, target: 1, time: null,
      durationMinutes: null, reminderTime: null, partialCounts: false, notes: '',
    })
    await actions.createActivity({
      name: 'Y', description: '', icon: 'i:code', color: 'blue', categoryId: null, kind: 'check', unit: '',
      startDate: '2026-01-05', endDate: null, rule: { freq: 'daily', interval: 1 }, target: 1, time: null,
      durationMinutes: null, reminderTime: null, partialCounts: false, notes: '',
    })
    const json = JSON.parse(await buildExport())
    json.data.activities[0].version = '1'
    const parsed = parseImport(JSON.stringify(json))
    expect(parsed.invalid).toBe(1)
    expect(parsed.counts.activities).toBe(1)
    expect(buildIndex(await snap(repo)).activities).toHaveLength(2)
  })
})
