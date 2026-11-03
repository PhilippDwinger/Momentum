import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { ensureWeeklyChallenges, getRepository } from '../data/actions'
import { DEFAULT_SETTINGS, SETTINGS_ID } from '../data/defaults'
import { logicalToday, startOfWeek } from '../domain/dates'
import { buildHistory, computeGame, type GameState, type History } from '../domain/gamification'
import { buildIndex, type DataIndex, type DataSnapshot } from '../domain/occurrences'
import { earliestStart } from '../domain/stats'
import type { DateKey, UserSettings } from '../domain/types'
import { useI18n } from '../i18n'
import { getPrefs, setPrefs } from './prefs'
import { useToast } from './toast'

export interface AppData {
  index: DataIndex
  today: DateKey
  history: History
  game: GameState
}

const AppDataContext = createContext<AppData | null>(null)

async function loadSnapshot(): Promise<DataSnapshot> {
  const db = getRepository().db
  const [activities, categories, entries, overrides, challenges, settings] = await Promise.all([
    db.activities.toArray(),
    db.categories.toArray(),
    db.entries.toArray(),
    db.overrides.toArray(),
    db.challenges.toArray(),
    db.settings.get(SETTINGS_ID),
  ])
  const s: UserSettings = settings && !settings.deletedAt ? { ...DEFAULT_SETTINGS, ...settings } : DEFAULT_SETTINGS
  return { activities, categories, entries, overrides, challenges, settings: s }
}

/** The logical "today", re-evaluated every 30 s and when the app becomes visible again. */
function useToday(dayStartHour: number): DateKey {
  const [today, setToday] = useState(() => logicalToday(new Date(), dayStartHour))
  useEffect(() => {
    const update = () => setToday(logicalToday(new Date(), dayStartHour))
    update()
    const timer = setInterval(update, 30_000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [dayStartHour])
  return today
}

export function AppDataProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const snapshot = useLiveQuery(loadSnapshot, [])
  const index = useMemo(() => (snapshot ? buildIndex(snapshot) : null), [snapshot])
  const today = useToday(index?.settings.dayStartHour ?? 0)
  const value = useMemo<AppData | null>(() => {
    if (!index) return null
    const history = buildHistory(index, earliestStart(index, today), today)
    return { index, today, history, game: computeGame(index, history, today) }
  }, [index, today])

  if (!value) return <>{fallback}</>
  return (
    <AppDataContext.Provider value={value}>
      <GameWatcher data={value} />
      {children}
    </AppDataContext.Provider>
  )
}

export function useAppData(): AppData {
  const ctx = useContext(AppDataContext)
  if (!ctx) throw new Error('useAppData outside provider')
  return ctx
}

/** Side effects derived from data: weekly challenges, achievement & level-up toasts. */
function GameWatcher({ data }: { data: AppData }) {
  const toast = useToast()
  const { t } = useI18n()
  const { index, today, game } = data
  const challengeTried = useRef<string>('')

  useEffect(() => {
    const week = startOfWeek(today, 1)
    const sig = `${week}:${index.activities.length}`
    if (challengeTried.current === sig) return
    challengeTried.current = sig
    ensureWeeklyChallenges(index, week, today).catch(() => {})
  }, [index, today])

  useEffect(() => {
    const prefs = getPrefs()
    const unlocked = game.achievements.filter((a) => a.unlockedAt).map((a) => a.id)
    if (prefs.seenAchievements === null) {
      setPrefs({ seenAchievements: unlocked, lastLevel: game.level.level })
      return
    }
    const fresh = unlocked.filter((id) => !prefs.seenAchievements!.includes(id))
    if (fresh.length === 1) toast({ message: t('ach.toast', { name: t(`ach.${fresh[0]}.name`) }), tone: 'celebrate' })
    else if (fresh.length > 1) toast({ message: t('ach.toastMany', { count: fresh.length }), tone: 'celebrate' })
    if (prefs.lastLevel !== null && game.level.level > prefs.lastLevel) {
      toast({ message: t('ach.levelUp', { level: game.level.level }), tone: 'celebrate' })
    }
    const highest = Math.max(prefs.lastLevel ?? 0, game.level.level)
    if (fresh.length || prefs.lastLevel !== highest) {
      // remember everything ever shown, so undo + redo never celebrates twice
      setPrefs({ seenAchievements: Array.from(new Set([...prefs.seenAchievements, ...unlocked])), lastLevel: highest })
    }
  }, [game, toast, t])
  return null
}
