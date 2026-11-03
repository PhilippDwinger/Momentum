/**
 * Generates a realistic demo backup (e2e/fixtures/demo-backup.json) with ~10 weeks of
 * history relative to the given "today". Used by the E2E tests to exercise import, stats,
 * streaks and the calendar with real-looking data.
 *   npx tsx e2e/make-demo.ts 2026-11-03
 */
import { writeFileSync } from 'node:fs'
import { addDays, rangeKeys } from '../src/domain/dates'
import { isScheduled } from '../src/domain/recurrence'
import type { Activity, Entry, RecurrenceRule } from '../src/domain/types'

const today = process.argv[2] ?? new Date().toISOString().slice(0, 10)
const start = addDays(today, -70)
let seed = 42
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
let clock = 1_700_000_000_000
const meta = (id: string) => ({ id, createdAt: clock, updatedAt: clock, version: `${String(++clock).padStart(15, '0')}:0000:demo`, deletedAt: null })

function act(id: string, name: string, icon: string, color: Activity['color'], cat: string, kind: Activity['kind'], target: number, unit: string, rule: RecurrenceRule, time: string | null, order: number): Activity {
  return {
    ...meta(id), name, description: '', icon, color, categoryId: `cat_${cat}`, kind, unit, startDate: start, endDate: null,
    schedule: [{ from: start, rule, target }], time, durationMinutes: kind === 'check' ? 60 : null, reminderTime: null,
    partialCounts: false, notes: '', archivedAt: null, pauses: [], sortOrder: order,
  }
}
const activities: Activity[] = [
  act('demo-japanese', 'Japanisch', 'i:languages', 'pink', 'learning', 'duration', 15, 'min', { freq: 'weekly', interval: 1, weekdays: [1, 3, 5] }, '19:30', 1),
  act('demo-gym', 'Training', 'i:dumbbell', 'ember', 'fitness', 'check', 1, '', { freq: 'weekly', interval: 1, weekdays: [2, 4, 6] }, '18:00', 2),
  act('demo-reading', 'Lesen', 'i:book-open', 'amber', 'learning', 'count', 10, 'Seiten', { freq: 'daily', interval: 1 }, '21:30', 3),
  act('demo-stretch', 'Dehnen', 'i:stretch-horizontal', 'teal', 'health', 'duration', 10, 'min', { freq: 'daily', interval: 1 }, '07:15', 4),
  act('demo-code', 'Programmieren', 'i:code', 'green', 'projects', 'duration', 30, 'min', { freq: 'weekly', interval: 1, weekdays: [1, 2, 3, 4, 5] }, null, 5),
  act('demo-water', 'Wasser trinken', 'i:glass-water', 'sky', 'health', 'count', 8, 'Gläser', { freq: 'daily', interval: 1 }, null, 6),
]
const rates: Record<string, number> = { 'demo-japanese': 0.85, 'demo-gym': 0.75, 'demo-reading': 0.8, 'demo-stretch': 0.65, 'demo-code': 0.7, 'demo-water': 0.6 }
const notes = ['Kana wiederholt', 'Super Session!', 'Etwas müde, aber gemacht', 'Neues Kapitel angefangen', '']
const entries: Entry[] = []
for (const a of activities) {
  for (const d of rangeKeys(start, addDays(today, -1))) {
    if (!isScheduled(a, d)) continue
    const r = rnd()
    const target = a.schedule[0].target
    // last 9 days: keep a streak going for a nicer demo
    const recent = d >= addDays(today, -9) && a.id !== 'demo-water'
    if (recent || r < rates[a.id]) entries.push({ ...meta(`e_${a.id}_${d}`), activityId: a.id, date: d, value: target, target, note: rnd() < 0.12 ? notes[Math.floor(rnd() * notes.length)] : '', loggedAt: clock })
    else if (a.kind !== 'check' && r < rates[a.id] + 0.12) entries.push({ ...meta(`e_${a.id}_${d}`), activityId: a.id, date: d, value: Math.round(target / 2), target, note: '', loggedAt: clock })
  }
}
// today: some progress already
for (const id of ['demo-stretch', 'demo-water']) {
  const a = activities.find((x) => x.id === id)!
  entries.push({ ...meta(`e_${id}_${today}`), activityId: id, date: today, value: id === 'demo-water' ? 3 : 10, target: a.schedule[0].target, note: '', loggedAt: clock })
}
const out = { format: 'momentum-export', schemaVersion: 1, exportedAt: new Date().toISOString(), deviceId: 'demo', data: { activities, categories: [], entries, overrides: [], challenges: [], settings: [{ ...meta('settings'), name: 'Paddy', dayStartHour: 0, weekStartsOn: 1, streakProtection: true, overloadThreshold: 5, showMotivation: true }] } }
writeFileSync(new URL('./fixtures/demo-backup.json', import.meta.url), JSON.stringify(out, null, 1))
console.log(`demo: ${activities.length} activities, ${entries.length} entries, today=${today}`)
