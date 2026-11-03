import type { DateKey, Weekday } from './types'

/**
 * Local calendar-date helpers. A DateKey (`YYYY-MM-DD`) represents a calendar day, not an
 * instant. Arithmetic is done on a UTC-midnight representation purely as a counting device,
 * which makes it immune to daylight-saving transitions.
 */

const DAY_MS = 86_400_000
const KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/

const pad = (n: number, len = 2) => String(n).padStart(len, '0')

export function makeKey(y: number, m: number, d: number): DateKey {
  return `${pad(y, 4)}-${pad(m)}-${pad(d)}`
}

export function isDateKey(value: unknown): value is DateKey {
  if (typeof value !== 'string') return false
  const m = KEY_RE.exec(value)
  if (!m) return false
  const y = +m[1]
  const mo = +m[2]
  const d = +m[3]
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo)
}

export function parseKey(key: DateKey): { y: number; m: number; d: number } {
  const m = KEY_RE.exec(key)
  if (!m) throw new Error(`Invalid date key: ${key}`)
  return { y: +m[1], m: +m[2], d: +m[3] }
}

function toSerial(key: DateKey): number {
  const { y, m, d } = parseKey(key)
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS)
}

function fromSerial(serial: number): DateKey {
  const dt = new Date(serial * DAY_MS)
  return makeKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate())
}

export function addDays(key: DateKey, n: number): DateKey {
  return fromSerial(toSerial(key) + n)
}

/** Number of days from `a` to `b` (b - a). */
export function diffDays(a: DateKey, b: DateKey): number {
  return toSerial(b) - toSerial(a)
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** ISO weekday 1 (Mon) … 7 (Sun). */
export function weekday(key: DateKey): Weekday {
  const dow = new Date(toSerial(key) * DAY_MS).getUTCDay()
  return (dow === 0 ? 7 : dow) as Weekday
}

/** First day of the week containing `key`. weekStartsOn: 1 = Monday, 0 = Sunday. */
export function startOfWeek(key: DateKey, weekStartsOn: 0 | 1 = 1): DateKey {
  const wd = weekday(key) // 1..7
  const offset = weekStartsOn === 1 ? wd - 1 : wd % 7
  return addDays(key, -offset)
}

export function startOfMonth(key: DateKey): DateKey {
  const { y, m } = parseKey(key)
  return makeKey(y, m, 1)
}

export function endOfMonth(key: DateKey): DateKey {
  const { y, m } = parseKey(key)
  return makeKey(y, m, daysInMonth(y, m))
}

/** Adds months, clamping the day to the target month's length. */
export function addMonths(key: DateKey, n: number): DateKey {
  const { y, m, d } = parseKey(key)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return makeKey(ny, nm, Math.min(d, daysInMonth(ny, nm)))
}

export function monthsBetween(a: DateKey, b: DateKey): number {
  const pa = parseKey(a)
  const pb = parseKey(b)
  return (pb.y - pa.y) * 12 + (pb.m - pa.m)
}

export function minKey(a: DateKey, b: DateKey): DateKey {
  return a < b ? a : b
}

export function maxKey(a: DateKey, b: DateKey): DateKey {
  return a > b ? a : b
}

/** Inclusive list of keys from `from` to `to`. */
export function rangeKeys(from: DateKey, to: DateKey): DateKey[] {
  const out: DateKey[] = []
  const end = toSerial(to)
  for (let s = toSerial(from); s <= end; s++) out.push(fromSerial(s))
  return out
}

/** Local calendar date of an instant. */
export function localKey(date: Date): DateKey {
  return makeKey(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/**
 * The "logical" today. With dayStartHour = 4, 02:30 local time still belongs to yesterday.
 * Uses local wall-clock hours, so DST shifts cannot move the boundary.
 */
export function logicalToday(now: Date = new Date(), dayStartHour = 0): DateKey {
  const key = localKey(now)
  return now.getHours() < dayStartHour ? addDays(key, -1) : key
}

/** A local Date at noon of the given key – safe for Intl formatting. */
export function keyToDate(key: DateKey): Date {
  const { y, m, d } = parseKey(key)
  return new Date(y, m - 1, d, 12, 0, 0)
}

export function isoWeek(key: DateKey): { year: number; week: number } {
  // Thursday of the current ISO week decides the year.
  const thursday = addDays(key, 4 - weekday(key))
  const { y } = parseKey(thursday)
  const jan1 = makeKey(y, 1, 1)
  return { year: y, week: Math.floor(diffDays(jan1, thursday) / 7) + 1 }
}

/** n-th occurrence of the weekday within its month (1-based). */
export function nthInMonth(key: DateKey): number {
  return Math.ceil(parseKey(key).d / 7)
}

export function isLastWeekdayInMonth(key: DateKey): boolean {
  const { y, m, d } = parseKey(key)
  return d + 7 > daysInMonth(y, m)
}

export function parseTime(time: string | null | undefined): number | null {
  if (!time) return null
  const m = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!m) return null
  const h = +m[1]
  const min = +m[2]
  if (h > 23 || min > 59) return null
  return h * 60 + min
}
