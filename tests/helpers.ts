import { DEFAULT_SETTINGS } from '../src/data/defaults'
import { buildIndex, type DataIndex } from '../src/domain/occurrences'
import type { Activity, Entry, OccurrenceOverride, RecurrenceRule, UserSettings } from '../src/domain/types'

let n = 0
const meta = (id: string) => ({ id, createdAt: 0, updatedAt: 0, version: '1', deletedAt: null })

export function activity(p: Partial<Activity> & { rule?: RecurrenceRule; target?: number } = {}): Activity {
  const id = p.id ?? `a${++n}`
  const startDate = p.startDate ?? '2026-01-05'
  const { rule, target, ...rest } = p
  return {
    ...meta(id),
    name: id,
    description: '',
    icon: 'i:circle',
    color: 'blue',
    categoryId: null,
    kind: 'check',
    unit: '',
    startDate,
    endDate: null,
    schedule: [{ from: startDate, rule: rule ?? { freq: 'daily', interval: 1 }, target: target ?? 1 }],
    time: null,
    durationMinutes: null,
    reminderTime: null,
    partialCounts: false,
    notes: '',
    archivedAt: null,
    pauses: [],
    sortOrder: n,
    ...rest,
  }
}

export function entry(a: Activity, date: string, value = 1, target = 1, note = ''): Entry {
  return { ...meta(`e_${a.id}_${date}`), activityId: a.id, date, value, target, note, loggedAt: 0 }
}

export function override(a: Activity, date: string, p: Partial<OccurrenceOverride>): OccurrenceOverride {
  return { ...meta(`o_${a.id}_${date}`), activityId: a.id, date, skipped: false, movedTo: null, target: null, time: null, ...p }
}

export function index(
  activities: Activity[],
  entries: Entry[] = [],
  overrides: OccurrenceOverride[] = [],
  settings: Partial<UserSettings> = {},
): DataIndex {
  return buildIndex({
    activities,
    categories: [],
    entries,
    overrides,
    challenges: [],
    settings: { ...DEFAULT_SETTINGS, streakProtection: false, ...settings },
  })
}
