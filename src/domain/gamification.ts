import { addDays, endOfMonth, rangeKeys, startOfMonth, startOfWeek } from './dates'
import { isDone, isPlanned, occurrencesByDate, progressOf, type DataIndex } from './occurrences'
import { computeStreak, type StreakInfo } from './streaks'
import type { Challenge, ChallengeType, DateKey, ID, Occurrence } from './types'

/**
 * Gamification is fully *derived* from progress data. Nothing is stored as a counter, so
 * undoing a completion removes its XP and synchronised history always yields the same level.
 *
 * Healthy-by-design rules:
 * - XP only for *planned* occurrences, capped at the target (over-achieving gives no extra XP).
 * - No XP for future dates (they cannot be logged anyway).
 * - A small bonus for completing the whole plan of a day; nothing is ever taken away.
 */

export const XP_PER_OCCURRENCE = 10
export const XP_PERFECT_DAY = 20

export interface History {
  from: DateKey
  to: DateKey
  byDate: Map<DateKey, Occurrence[]>
}

export function buildHistory(index: DataIndex, from: DateKey, to: DateKey): History {
  return { from, to, byDate: from <= to ? occurrencesByDate(index, from, to) : new Map() }
}

export function isPerfectDay(occs: Occurrence[]): boolean {
  const planned = occs.filter(isPlanned)
  return planned.length > 0 && planned.every(isDone)
}

export function xpForOccurrence(occ: Occurrence): number {
  if (!isPlanned(occ)) return 0
  return Math.round(XP_PER_OCCURRENCE * progressOf(occ))
}

export function xpByDate(history: History, today: DateKey): Map<DateKey, number> {
  const map = new Map<DateKey, number>()
  for (const [date, occs] of history.byDate) {
    if (date > today) continue
    let xp = 0
    for (const o of occs) xp += xpForOccurrence(o)
    if (isPerfectDay(occs)) xp += XP_PERFECT_DAY
    if (xp > 0) map.set(date, xp)
  }
  return map
}

/** Cumulative XP needed to reach `level` (level 1 = 0 XP). */
export function levelThreshold(level: number): number {
  const l = Math.max(1, Math.floor(level)) - 1
  return 100 * l + 25 * l * (l - 1)
}

export interface LevelInfo {
  level: number
  xp: number
  /** XP earned inside the current level. */
  intoLevel: number
  /** XP span of the current level. */
  span: number
  progress: number
}

export function levelFor(xp: number): LevelInfo {
  let level = 1
  while (levelThreshold(level + 1) <= xp) level++
  const base = levelThreshold(level)
  const span = levelThreshold(level + 1) - base
  return { level, xp, intoLevel: xp - base, span, progress: span > 0 ? (xp - base) / span : 0 }
}

export function levelTitleKey(level: number): string {
  if (level >= 20) return 'level.legend'
  if (level >= 15) return 'level.master'
  if (level >= 10) return 'level.steady'
  if (level >= 6) return 'level.routine'
  if (level >= 3) return 'level.explorer'
  return 'level.starter'
}

// ---------------------------------------------------------------------------
// Weekly challenges
// ---------------------------------------------------------------------------

export interface ChallengeDraft {
  week: DateKey
  type: ChallengeType
  goal: number
  activityId: ID | null
  xp: number
}

export const challengeId = (week: DateKey, type: ChallengeType) => `ch_${week}_${type}`

/**
 * Proposes up to three personal, achievable challenges for the ISO week starting `week`.
 * Goals are based on the user's own recent history and never exceed what is planned.
 */
export function proposeChallenges(index: DataIndex, week: DateKey, today: DateKey): ChallengeDraft[] {
  const weekEnd = addDays(week, 6)
  const thisWeek = occurrencesByDate(index, week, weekEnd)
  const plannedThisWeek = [...thisWeek.values()].flat().filter(isPlanned)
  if (plannedThisWeek.length < 3) return []
  const drafts: ChallengeDraft[] = []

  // 1) completions, based on the 4-week average
  const pastFrom = addDays(week, -28)
  const past = occurrencesByDate(index, pastFrom, addDays(week, -1))
  const pastDone = [...past.values()].flat().filter((o) => isPlanned(o) && isDone(o)).length
  const avg = pastDone / 4
  let goal = avg > 0 ? Math.round(avg * 1.1) + 1 : Math.ceil(plannedThisWeek.length * 0.7)
  goal = Math.max(3, Math.min(plannedThisWeek.length, goal))
  drafts.push({ week, type: 'completions', goal, activityId: null, xp: 30 })

  // 2) perfect days
  const daysWithPlan = rangeKeys(week, weekEnd).filter((d) => (thisWeek.get(d) ?? []).some(isPlanned)).length
  if (daysWithPlan >= 2) {
    drafts.push({ week, type: 'perfectDays', goal: Math.min(3, daysWithPlan), activityId: null, xp: 40 })
  }

  // 3) focus activity: lowest recent completion rate, at least 2 occurrences this week
  const perActivity = new Map<ID, number>()
  for (const o of plannedThisWeek) perActivity.set(o.activityId, (perActivity.get(o.activityId) ?? 0) + 1)
  let pick: { id: ID; rate: number; count: number; name: string } | null = null
  for (const [id, count] of perActivity) {
    if (count < 2) continue
    const a = index.activityById.get(id)!
    const hist = [...past.values()].flat().filter((o) => o.activityId === id && isPlanned(o))
    const rate = hist.length ? hist.filter(isDone).length / hist.length : 0.5
    if (!pick || rate < pick.rate || (rate === pick.rate && a.name < pick.name)) pick = { id, rate, count, name: a.name }
  }
  if (pick) drafts.push({ week, type: 'activityAll', goal: pick.count, activityId: pick.id, xp: 30 })
  void today
  return drafts
}

export interface ChallengeProgress {
  value: number
  goal: number
  done: boolean
}

export function challengeProgress(ch: Challenge, index: DataIndex, today: DateKey): ChallengeProgress {
  const to = addDays(ch.week, 6)
  const end = to < today ? to : today
  const byDate = end >= ch.week ? occurrencesByDate(index, ch.week, end) : new Map<DateKey, Occurrence[]>()
  let value = 0
  if (ch.type === 'completions') {
    for (const occs of byDate.values()) value += occs.filter((o) => isPlanned(o) && isDone(o)).length
  } else if (ch.type === 'perfectDays') {
    for (const occs of byDate.values()) if (isPerfectDay(occs)) value++
  } else {
    for (const occs of byDate.values()) value += occs.filter((o) => o.activityId === ch.activityId && isPlanned(o) && isDone(o)).length
  }
  return { value: Math.min(value, ch.goal), goal: ch.goal, done: value >= ch.goal }
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface AchievementState {
  id: string
  icon: string
  unlockedAt: DateKey | null
  progress: { value: number; goal: number }
}

export interface GameState {
  xp: number
  level: LevelInfo
  xpToday: number
  achievements: AchievementState[]
  streaks: Map<ID, StreakInfo>
  challengeXp: number
}

const firstNth = (sortedDates: DateKey[], n: number): DateKey | null => (sortedDates.length >= n ? sortedDates[n - 1] : null)

export function computeGame(index: DataIndex, history: History, today: DateKey): GameState {
  const xpMap = xpByDate(history, today)
  const datesAsc = [...history.byDate.keys()].filter((d) => d <= today).sort()

  // challenges
  let challengeXp = 0
  const challengeXpDates: { date: DateKey; xp: number }[] = []
  for (const ch of index.challenges) {
    if (ch.week > today) continue
    const p = challengeProgress(ch, index, today)
    if (p.done) {
      challengeXp += ch.xp
      const end = addDays(ch.week, 6)
      challengeXpDates.push({ date: end < today ? end : today, xp: ch.xp })
    }
  }

  // cumulative XP per date for level achievements
  const cumulative: { date: DateKey; total: number }[] = []
  let running = 0
  const extra = new Map<DateKey, number>()
  for (const c of challengeXpDates) extra.set(c.date, (extra.get(c.date) ?? 0) + c.xp)
  const allXpDates = Array.from(new Set([...xpMap.keys(), ...extra.keys()])).sort()
  for (const d of allXpDates) {
    running += (xpMap.get(d) ?? 0) + (extra.get(d) ?? 0)
    cumulative.push({ date: d, total: running })
  }
  const xp = running
  const levelReached = (lvl: number): DateKey | null => cumulative.find((c) => c.total >= levelThreshold(lvl))?.date ?? null

  // completions
  const doneDates: DateKey[] = []
  const perfectDates: DateKey[] = []
  let noted = 0
  const notedDates: DateKey[] = []
  let varietyDate: DateKey | null = null
  for (const d of datesAsc) {
    const occs = history.byDate.get(d) ?? []
    const cats = new Set<string>()
    for (const o of occs) {
      if (isDone(o)) {
        doneDates.push(d)
        const a = index.activityById.get(o.activityId)
        if (a?.categoryId) cats.add(a.categoryId)
      }
      if (o.entry?.note?.trim()) {
        noted++
        notedDates.push(d)
      }
    }
    if (isPerfectDay(occs)) perfectDates.push(d)
    if (!varietyDate && cats.size >= 3) varietyDate = d
  }

  // streaks + comeback
  const streaks = new Map<ID, StreakInfo>()
  let streak7: DateKey | null = null
  let streak30: DateKey | null = null
  let bestStreak = 0
  for (const a of index.activities) {
    const s = computeStreak(index, a, today)
    streaks.set(a.id, s)
    bestStreak = Math.max(bestStreak, s.longest)
    if (s.milestones[7] && (!streak7 || s.milestones[7] < streak7)) streak7 = s.milestones[7]
    if (s.milestones[30] && (!streak30 || s.milestones[30] < streak30)) streak30 = s.milestones[30]
  }
  let comeback: DateKey | null = null
  {
    const lastMissed = new Map<ID, boolean>()
    for (const d of datesAsc) {
      for (const o of history.byDate.get(d) ?? []) {
        if (!isPlanned(o)) continue
        if (isDone(o)) {
          if (lastMissed.get(o.activityId) && !comeback) comeback = d
          lastMissed.set(o.activityId, false)
        } else if (d < today) lastMissed.set(o.activityId, true)
      }
    }
  }

  // perfect week (Mon–Sun, at least 3 planned, all done)
  let perfectWeek: DateKey | null = null
  {
    const weeks = new Map<DateKey, Occurrence[]>()
    for (const d of datesAsc) {
      const w = startOfWeek(d, 1)
      weeks.set(w, [...(weeks.get(w) ?? []), ...(history.byDate.get(d) ?? [])])
    }
    for (const [w, occs] of [...weeks.entries()].sort()) {
      const weekEnd = addDays(w, 6)
      if (weekEnd > today) {
        // the current week only counts once nothing is left open
        const future = occurrencesByDate(index, addDays(today, 1), weekEnd)
        if ([...future.values()].flat().some(isPlanned)) continue
      }
      const planned = occs.filter(isPlanned)
      if (planned.length >= 3 && planned.every(isDone)) {
        perfectWeek = weekEnd < today ? weekEnd : today
        break
      }
    }
  }

  // consistent month: closed calendar month, >= 10 planned, >= 80 % done
  let consistentMonth: DateKey | null = null
  let bestMonthRate = 0
  {
    const months = new Map<DateKey, { planned: number; done: number }>()
    for (const d of datesAsc) {
      const m = startOfMonth(d)
      const acc = months.get(m) ?? { planned: 0, done: 0 }
      for (const o of history.byDate.get(d) ?? []) {
        if (!isPlanned(o)) continue
        acc.planned++
        if (isDone(o)) acc.done++
      }
      months.set(m, acc)
    }
    for (const [m, acc] of [...months.entries()].sort()) {
      const end = endOfMonth(m)
      if (acc.planned >= 10) bestMonthRate = Math.max(bestMonthRate, acc.done / acc.planned)
      if (end >= today) continue
      if (acc.planned >= 10 && acc.done / acc.planned >= 0.8) {
        consistentMonth = end
        break
      }
    }
  }

  const createdDates = index.activities.map((a) => a.startDate).sort()

  const ach = (id: string, icon: string, unlockedAt: DateKey | null, value: number, goal: number): AchievementState => ({
    id,
    icon,
    unlockedAt,
    progress: { value: Math.min(value, goal), goal },
  })

  const achievements: AchievementState[] = [
    ach('first', 'sparkles', firstNth(doneDates, 1), doneDates.length, 1),
    ach('perfectDay', 'sun', perfectDates[0] ?? null, perfectDates.length, 1),
    ach('streak7', 'flame', streak7, bestStreak, 7),
    ach('total30', 'check-check', firstNth(doneDates, 30), doneDates.length, 30),
    ach('perfectWeek', 'calendar-check', perfectWeek, perfectWeek ? 1 : 0, 1),
    ach('comeback', 'rotate-ccw', comeback, comeback ? 1 : 0, 1),
    ach('variety', 'shapes', varietyDate, varietyDate ? 3 : 0, 3),
    ach('planner', 'layout-list', firstNth(createdDates, 5), createdDates.length, 5),
    ach('reflect', 'notebook-pen', firstNth(notedDates, 10), noted, 10),
    ach('total100', 'medal', firstNth(doneDates, 100), doneDates.length, 100),
    ach('consistentMonth', 'calendar-range', consistentMonth, Math.round(bestMonthRate * 100), 80),
    ach('streak30', 'mountain', streak30, bestStreak, 30),
    ach('level5', 'star', levelReached(5), xp, levelThreshold(5)),
    ach('level10', 'crown', levelReached(10), xp, levelThreshold(10)),
    ach('total365', 'trophy', firstNth(doneDates, 365), doneDates.length, 365),
  ]

  return {
    xp,
    level: levelFor(xp),
    xpToday: xpMap.get(today) ?? 0,
    achievements,
    streaks,
    challengeXp,
  }
}
