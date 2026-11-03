import { occurrencesByDate, progressOf, statusOf, type DataIndex } from '../domain/occurrences'
import { earliestStart, type DaySummary } from '../domain/stats'
import { SYNCED_TABLES } from '../domain/types'
import { applyRemoteRecords } from '../sync/merge'
import type { ParsedImport } from './importParse'
import { SCHEMA_VERSION } from './db'
import { getRepository } from './actions'

export const EXPORT_FORMAT = 'momentum-export'
export type { ParsedImport }

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
