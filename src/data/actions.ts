import { addDays } from '../domain/dates'
import { challengeId, proposeChallenges } from '../domain/gamification'
import { isDone, occKey, type DataIndex } from '../domain/occurrences'
import { normalizeRule, scheduleWithChangeFrom } from '../domain/recurrence'
import type {
  Activity,
  ActivityKind,
  Category,
  Challenge,
  ColorKey,
  DateKey,
  Entry,
  ID,
  Occurrence,
  OccurrenceOverride,
  RecurrenceRule,
  SyncMeta,
  UserSettings,
} from '../domain/types'
import { uuidv7 } from '../sync/clock'
import { DEFAULT_SETTINGS, SETTINGS_ID, builtinCategoryRecords } from './defaults'
import type { LocalRepository } from './repository'

/**
 * High-level, intention-revealing mutations. This is the API the UI uses.
 * All writes go through LocalRepository (stamping + change log).
 */

let repo: LocalRepository | null = null

export function setRepository(r: LocalRepository) {
  repo = r
}

export function getRepository(): LocalRepository {
  if (!repo) throw new Error('Repository not initialised')
  return repo
}

type NoMeta<T> = Omit<T, keyof SyncMeta> & { id: ID }

export async function ensureSeeded(): Promise<void> {
  const r = getRepository()
  const seeded = await r.db.meta.get('seeded')
  if (seeded) return
  if ((await r.db.categories.count()) === 0) await r.putMany('categories', builtinCategoryRecords())
  await r.db.meta.put({ key: 'seeded', value: true })
}

// ---------------------------------------------------------------------------
// Activities
// ---------------------------------------------------------------------------

export interface ActivityDraft {
  name: string
  description: string
  icon: string
  color: ColorKey
  categoryId: ID | null
  kind: ActivityKind
  unit: string
  startDate: DateKey
  endDate: DateKey | null
  rule: RecurrenceRule
  target: number
  time: string | null
  durationMinutes: number | null
  reminderTime: string | null
  partialCounts: boolean
  notes: string
}

export type ScheduleScope = { mode: 'all' } | { mode: 'from'; from: DateKey }

function cleanDraft(d: ActivityDraft) {
  const target = d.kind === 'check' ? 1 : Math.max(0.01, Number(d.target) || 1)
  return {
    name: d.name.trim().slice(0, 80) || 'Activity',
    description: d.description.trim().slice(0, 500),
    icon: d.icon || 'i:circle-check',
    color: d.color,
    categoryId: d.categoryId,
    kind: d.kind,
    unit: d.kind === 'duration' ? 'min' : d.unit.trim().slice(0, 20),
    startDate: d.startDate,
    endDate: d.endDate && d.endDate >= d.startDate ? d.endDate : null,
    time: d.time || null,
    durationMinutes: d.durationMinutes && d.durationMinutes > 0 ? Math.round(d.durationMinutes) : null,
    reminderTime: d.reminderTime || null,
    partialCounts: d.kind === 'check' ? false : d.partialCounts,
    notes: d.notes.slice(0, 5000),
    target,
    rule: normalizeRule(d.rule),
  }
}

export async function createActivity(draft: ActivityDraft, index?: DataIndex): Promise<Activity> {
  const r = getRepository()
  const c = cleanDraft(draft)
  const maxOrder = index ? Math.max(0, ...index.activities.map((a) => a.sortOrder)) : Date.now() / 1e6
  const { target, rule, ...rest } = c
  const record: NoMeta<Activity> = {
    id: uuidv7(),
    ...rest,
    schedule: [{ from: c.startDate, rule, target }],
    archivedAt: null,
    pauses: [],
    sortOrder: maxOrder + 1,
  }
  return r.put('activities', record)
}

export async function updateActivity(activity: Activity, draft: ActivityDraft, scope: ScheduleScope): Promise<Activity> {
  const r = getRepository()
  const c = cleanDraft(draft)
  const { target, rule, ...rest } = c
  let schedule = activity.schedule
  let startDate = activity.startDate
  if (scope.mode === 'all' || scope.from <= activity.startDate) {
    startDate = c.startDate
    schedule = [{ from: startDate, rule, target }]
  } else {
    schedule = scheduleWithChangeFrom(activity.schedule, scope.from, rule, target)
  }
  const next: Activity = { ...activity, ...rest, startDate, schedule }
  return r.put('activities', next)
}

export async function archiveActivity(activity: Activity, today: DateKey, index: DataIndex): Promise<void> {
  // keep today's occurrence if it already has progress
  const hasProgressToday = !!index.entries.get(occKey(activity.id, today))
  await getRepository().patch<Activity>('activities', activity.id, { archivedAt: hasProgressToday ? addDays(today, 1) : today })
}

export async function unarchiveActivity(activity: Activity, today: DateKey): Promise<void> {
  const pauses = [...(activity.pauses ?? [])]
  if (activity.archivedAt && activity.archivedAt < today) pauses.push({ from: activity.archivedAt, to: addDays(today, -1) })
  await getRepository().patch<Activity>('activities', activity.id, { archivedAt: null, pauses })
}

export async function setPauses(activity: Activity, pauses: Activity['pauses']): Promise<void> {
  await getRepository().patch<Activity>('activities', activity.id, { pauses })
}

/** Permanent delete: activity and all of its progress become tombstones. */
export async function deleteActivity(activity: Activity): Promise<void> {
  const r = getRepository()
  await r.transaction(async () => {
    const entries = await r.db.entries.where('activityId').equals(activity.id).primaryKeys()
    const overrides = await r.db.overrides.where('activityId').equals(activity.id).primaryKeys()
    await r.remove('entries', entries)
    await r.remove('overrides', overrides)
    await r.remove('activities', [activity.id])
  })
}

export async function restoreActivity(snapshot: { activity: Activity; entries: Entry[]; overrides: OccurrenceOverride[] }) {
  const r = getRepository()
  await r.transaction(async () => {
    await r.put('activities', { ...snapshot.activity, deletedAt: null })
    await r.putMany('entries', snapshot.entries.map((e) => ({ ...e, deletedAt: null })))
    await r.putMany('overrides', snapshot.overrides.map((o) => ({ ...o, deletedAt: null })))
  })
}

export async function duplicateActivity(activity: Activity, today: DateKey, index: DataIndex): Promise<Activity> {
  const seg = activity.schedule[activity.schedule.length - 1]
  return createActivity(
    {
      ...activity,
      name: activity.name,
      startDate: today,
      endDate: null,
      rule: seg.rule,
      target: seg.target,
    },
    index,
  )
}

// ---------------------------------------------------------------------------
// Progress (entries) and per-occurrence overrides
// ---------------------------------------------------------------------------

export class FutureLogError extends Error {
  constructor() {
    super('Future occurrences cannot be completed yet.')
    this.name = 'FutureLogError'
  }
}

export const entryId = (activityId: ID, date: DateKey) => `e_${activityId}_${date}`
export const overrideId = (activityId: ID, date: DateKey) => `o_${activityId}_${date}`

export async function logProgress(occ: Occurrence, value: number, today: DateKey, note?: string): Promise<void> {
  if (occ.date > today) throw new FutureLogError()
  const r = getRepository()
  const v = Math.max(0, Math.round((Number(value) || 0) * 100) / 100)
  const nextNote = note ?? occ.entry?.note ?? ''
  const id = entryId(occ.activityId, occ.originalDate)
  if (v === 0 && !nextNote.trim()) {
    if (occ.entry) await r.remove('entries', [id])
    return
  }
  const record: NoMeta<Entry> = {
    id,
    activityId: occ.activityId,
    date: occ.originalDate,
    value: v,
    target: occ.target,
    note: nextNote,
    loggedAt: v !== (occ.entry?.value ?? 0) ? Date.now() : (occ.entry?.loggedAt ?? Date.now()),
  }
  await r.put('entries', record)
}

export async function toggleDone(occ: Occurrence, today: DateKey): Promise<boolean> {
  const done = isDone(occ)
  await logProgress(occ, done ? 0 : occ.target, today)
  return !done
}

export async function setNote(occ: Occurrence, note: string): Promise<void> {
  const r = getRepository()
  const id = entryId(occ.activityId, occ.originalDate)
  const value = occ.entry?.value ?? 0
  if (value === 0 && !note.trim()) {
    if (occ.entry) await r.remove('entries', [id])
    return
  }
  await r.put('entries', {
    id,
    activityId: occ.activityId,
    date: occ.originalDate,
    value,
    target: occ.entry?.target ?? occ.target,
    note: note.slice(0, 2000),
    loggedAt: occ.entry?.loggedAt ?? Date.now(),
  } satisfies NoMeta<Entry>)
}

async function saveOverride(occ: Occurrence, patch: Partial<Pick<OccurrenceOverride, 'skipped' | 'movedTo' | 'target' | 'time'>>) {
  const r = getRepository()
  const id = overrideId(occ.activityId, occ.originalDate)
  const base = occ.override
  const next = {
    skipped: base?.skipped ?? false,
    movedTo: base?.movedTo ?? null,
    target: base?.target ?? null,
    time: base?.time ?? null,
    ...patch,
  }
  if (next.movedTo === occ.originalDate) next.movedTo = null
  const empty = !next.skipped && !next.movedTo && next.target === null && next.time === null
  if (empty) {
    if (base && !base.deletedAt) await r.remove('overrides', [id])
    return
  }
  await r.put('overrides', { id, activityId: occ.activityId, date: occ.originalDate, ...next } satisfies NoMeta<OccurrenceOverride>)
}

export const moveOccurrence = (occ: Occurrence, to: DateKey) => saveOverride(occ, { movedTo: to })
export const skipOccurrence = (occ: Occurrence, skipped: boolean) => saveOverride(occ, { skipped })
export const setOccurrenceDetails = (occ: Occurrence, d: { target?: number | null; time?: string | null }) =>
  saveOverride(occ, d)
export const resetOccurrence = (occ: Occurrence) => saveOverride(occ, { skipped: false, movedTo: null, target: null, time: null })

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function saveCategory(cat: Partial<Category> & { name: string; color: ColorKey; icon: string }, index: DataIndex) {
  const r = getRepository()
  const existing = cat.id ? index.categoryById.get(cat.id) : undefined
  await r.put('categories', {
    id: existing?.id ?? uuidv7(),
    name: cat.name.trim().slice(0, 40),
    builtin: existing?.builtin ?? null,
    color: cat.color,
    icon: cat.icon,
    sortOrder: existing?.sortOrder ?? index.categories.length,
  } satisfies NoMeta<Category>)
}

export async function deleteCategory(cat: Category, index: DataIndex) {
  const r = getRepository()
  await r.transaction(async () => {
    for (const a of index.activities) if (a.categoryId === cat.id) await r.patch<Activity>('activities', a.id, { categoryId: null })
    await r.remove('categories', [cat.id])
  })
}

// ---------------------------------------------------------------------------
// Settings, challenges, reset
// ---------------------------------------------------------------------------

export async function updateSettings(current: UserSettings, patch: Partial<UserSettings>) {
  const r = getRepository()
  const { createdAt: _c, updatedAt: _u, version: _v, deletedAt: _d, ...rest } = { ...DEFAULT_SETTINGS, ...current, ...patch }
  await r.put('settings', { ...rest, id: SETTINGS_ID })
}

export async function ensureWeeklyChallenges(index: DataIndex, week: DateKey, today: DateKey): Promise<boolean> {
  if (index.challenges.some((c) => c.week === week)) return false
  const drafts = proposeChallenges(index, week, today)
  if (drafts.length === 0) return false
  const records: NoMeta<Challenge>[] = drafts.map((d) => ({ id: challengeId(d.week, d.type), ...d }))
  await getRepository().putMany('challenges', records)
  return true
}

/** Deletes all synchronised data as tombstones (sync-safe) and re-seeds categories. */
export async function deleteAllData(): Promise<void> {
  const r = getRepository()
  await r.transaction(async () => {
    for (const t of ['activities', 'categories', 'entries', 'overrides', 'challenges', 'settings'] as const) {
      const ids = (await r.db.table(t).toArray()).filter((x) => !x.deletedAt).map((x) => x.id as string)
      await r.remove(t, ids)
    }
    await r.putMany('categories', builtinCategoryRecords())
  })
}
