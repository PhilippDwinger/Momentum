import { z } from 'zod'
import { isDateKey } from '../domain/dates'
import { occurrencesByDate, progressOf, statusOf, type DataIndex } from '../domain/occurrences'
import { earliestStart, type DaySummary } from '../domain/stats'
import { COLOR_KEYS, SYNCED_TABLES, type SyncedTable } from '../domain/types'
import { applyRemoteRecords } from '../sync/merge'
import type { SyncRecord, SyncRecordData } from '../sync/types'
import { SCHEMA_VERSION } from './db'
import { getRepository } from './actions'

export const EXPORT_FORMAT = 'momentum-export'

// ---------------------------------------------------------------------------
// Validation schemas (lenient on optional fields, strict on identity & dates)
// ---------------------------------------------------------------------------

const dateKey = z.string().refine(isDateKey, 'invalid date')
const time = z.string().regex(/^\d{1,2}:\d{2}$/).nullable().catch(null)
const meta = {
  id: z.string().min(1).max(200),
  createdAt: z.number().finite(),
  updatedAt: z.number().finite(),
  version: z.string().min(1).max(200),
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
    schedule: z.array(z.object({ from: dateKey, rule, target: z.number().positive() })).min(1),
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

export async function buildExport(): Promise<string> {
  const r = getRepository()
  const data: Record<string, unknown[]> = {}
  for (const t of SYNCED_TABLES) data[t] = await r.db.table(t).toArray()
  return JSON.stringify(
    { format: EXPORT_FORMAT, schemaVersion: SCHEMA_VERSION, exportedAt: new Date().toISOString(), deviceId: r.deviceId, data },
    null,
    2,
  )
}

/**
 * merge:   last-writer-wins per record (same rules as future sync). Newer local data is kept.
 * replace: existing data is tombstoned, imported (non-deleted) records become the new truth.
 */
export async function applyImport(parsed: ParsedImport, mode: 'merge' | 'replace'): Promise<number> {
  const r = getRepository()
  if (mode === 'merge') {
    const res = await applyRemoteRecords(r, parsed.records, { logChanges: true })
    return res.applied
  }
  const live = parsed.records.filter((x) => !x.record.deletedAt)
  await r.transaction(async () => {
    for (const t of SYNCED_TABLES) {
      const keep = new Set(live.filter((x) => x.table === t).map((x) => x.record.id))
      const ids = (await r.db.table(t).toArray()).filter((x) => !x.deletedAt && !keep.has(x.id)).map((x) => x.id as string)
      await r.remove(t, ids)
      await r.putMany(t, live.filter((x) => x.table === t).map((x) => x.record))
    }
  })
  return live.length
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function csvCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
}

export function occurrencesCsv(index: DataIndex, today: string, categoryName: (id: string | null) => string): string {
  const from = earliestStart(index, today)
  const byDate = occurrencesByDate(index, from, today)
  const rows: unknown[][] = [['date', 'activity', 'category', 'status', 'value', 'target', 'unit', 'progress_percent', 'moved_from', 'note']]
  for (const d of [...byDate.keys()].sort()) {
    for (const o of byDate.get(d)!) {
      const a = index.activityById.get(o.activityId)!
      rows.push([
        o.date,
        a.name,
        categoryName(a.categoryId),
        o.unplanned ? 'unplanned' : statusOf(o, today),
        o.entry?.value ?? 0,
        o.target,
        a.kind === 'check' ? '' : a.unit,
        Math.round(progressOf(o) * 100),
        o.moved ? o.originalDate : '',
        o.entry?.note ?? '',
      ])
    }
  }
  return toCsv(rows)
}

export function dailyCsv(days: DaySummary[]): string {
  const rows: unknown[][] = [['date', 'planned', 'done', 'partial', 'missed', 'skipped', 'open', 'rate_percent']]
  for (const d of days) {
    rows.push([d.date, d.planned, d.done, d.partial, d.missed, d.skipped, d.open, d.evaluated ? Math.round((d.done / d.evaluated) * 100) : ''])
  }
  return toCsv(rows)
}

export function downloadFile(name: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
