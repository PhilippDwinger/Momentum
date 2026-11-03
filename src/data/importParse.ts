import { z } from 'zod'
import { isDateKey } from '../domain/dates'
import { COLOR_KEYS, SYNCED_TABLES, type SyncedTable } from '../domain/types'
import { parseHlc } from '../sync/clock'
import type { SyncRecord, SyncRecordData } from '../sync/types'
import { SCHEMA_VERSION } from './db'

/**
 * Validation of backup files. Kept in its own module so the validation library is only
 * loaded when the user actually imports something.
 */
const EXPORT_FORMAT = 'momentum-export'

// ---------------------------------------------------------------------------
// Validation schemas (lenient on optional fields, strict on identity & dates)
// ---------------------------------------------------------------------------

const dateKey = z.string().refine(isDateKey, 'invalid date')
const time = z.string().regex(/^\d{1,2}:\d{2}$/).nullable().catch(null)
const meta = {
  id: z.string().min(1).max(200),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  version: z.string().max(200).refine((v) => parseHlc(v) !== null, 'invalid version'),
  deletedAt: z.number().finite().nullable().catch(null),
}
const color = z.enum(COLOR_KEYS as [string, ...string[]]).catch('slate')
const weekdayNum = z.number().int().min(1).max(7)
const rule = z.object({
  freq: z.enum(['once', 'daily', 'weekly', 'monthly']),
  interval: z.number().int().min(1).max(365).catch(1),
  weekdays: z.array(weekdayNum).optional(),
  monthlyMode: z.enum(['day', 'weekday']).optional(),
  monthDay: z.number().int().min(1).max(31).optional(),
  nth: z.number().int().min(-1).max(4).optional(),
  nthWeekday: weekdayNum.optional(),
})

const schemas: Record<SyncedTable, z.ZodType> = {
  activities: z.object({
    ...meta,
    name: z.string().max(200),
    description: z.string().max(2000).catch(''),
    icon: z.string().max(60).catch('i:circle-check'),
    color,
    categoryId: z.string().nullable().catch(null),
    kind: z.enum(['check', 'duration', 'count', 'custom']),
    unit: z.string().max(40).catch(''),
    startDate: dateKey,
    endDate: dateKey.nullable().catch(null),
    schedule: z
      .array(z.object({ from: dateKey, anchor: dateKey.optional(), rule, target: z.number().positive() }))
      .min(1)
      .transform((list) => [...list].sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0))),
    time,
    durationMinutes: z.number().nullable().catch(null),
    reminderTime: time,
    partialCounts: z.boolean().catch(false),
    notes: z.string().max(10000).catch(''),
    archivedAt: dateKey.nullable().catch(null),
    pauses: z.array(z.object({ from: dateKey, to: dateKey })).catch([]),
    sortOrder: z.number().catch(0),
  }),
  categories: z.object({
    ...meta,
    name: z.string().max(100).catch(''),
    builtin: z.string().nullable().catch(null),
    color,
    icon: z.string().max(60).catch('i:tag'),
    sortOrder: z.number().catch(0),
  }),
  entries: z.object({
    ...meta,
    activityId: z.string().min(1),
    date: dateKey,
    value: z.number().min(0),
    target: z.number().positive(),
    note: z.string().max(5000).catch(''),
    loggedAt: z.number().catch(0),
  }),
  overrides: z.object({
    ...meta,
    activityId: z.string().min(1),
    date: dateKey,
    skipped: z.boolean().catch(false),
    movedTo: dateKey.nullable().catch(null),
    target: z.number().positive().nullable().catch(null),
    time,
  }),
  challenges: z.object({
    ...meta,
    week: dateKey,
    type: z.enum(['completions', 'perfectDays', 'activityAll']),
    goal: z.number().int().positive(),
    activityId: z.string().nullable().catch(null),
    xp: z.number().int().min(0).max(1000),
  }),
  settings: z.object({
    ...meta,
    name: z.string().max(80).catch(''),
    dayStartHour: z.number().int().min(0).max(6).catch(0),
    weekStartsOn: z.union([z.literal(0), z.literal(1)]).catch(1),
    streakProtection: z.boolean().catch(true),
    overloadThreshold: z.number().int().min(2).max(20).catch(5),
    showMotivation: z.boolean().catch(true),
  }),
}

export interface ParsedImport {
  records: SyncRecord[]
  counts: Record<SyncedTable, number>
  invalid: number
  exportedAt: string | null
  schemaVersion: number
}

export class ImportError extends Error {
  constructor(public code: 'json' | 'format' | 'version' | 'empty') {
    super(code)
    this.name = 'ImportError'
  }
}

/** Parses and validates an export file. Invalid records are dropped and counted. */
export function parseImport(text: string): ParsedImport {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new ImportError('json')
  }
  const head = z
    .object({ format: z.literal(EXPORT_FORMAT), schemaVersion: z.number().int(), exportedAt: z.string().optional(), data: z.record(z.string(), z.array(z.unknown())) })
    .safeParse(raw)
  if (!head.success) throw new ImportError('format')
  if (head.data.schemaVersion > SCHEMA_VERSION) throw new ImportError('version')
  const counts = Object.fromEntries(SYNCED_TABLES.map((t) => [t, 0])) as Record<SyncedTable, number>
  const records: SyncRecord[] = []
  let invalid = 0
  for (const table of SYNCED_TABLES) {
    for (const item of head.data.data[table] ?? []) {
      const res = schemas[table].safeParse(item)
      if (!res.success) {
        invalid++
        continue
      }
      records.push({ table, record: res.data as SyncRecordData })
      if (!(res.data as SyncRecordData).deletedAt) counts[table]++
    }
  }
  if (records.length === 0) throw new ImportError('empty')
  return { records, counts, invalid, exportedAt: head.data.exportedAt ?? null, schemaVersion: head.data.schemaVersion }
}

