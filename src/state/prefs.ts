import { useSyncExternalStore } from 'react'
import { detectLang, type Lang } from '../i18n'

/**
 * Device-local preferences (never synchronised): theme, language, UI state, notification
 * bookkeeping. Stored in localStorage; every access is guarded because storage can be
 * unavailable (private mode, blocked site data).
 */
export interface Prefs {
  theme: 'system' | 'light' | 'dark'
  lang: Lang
  calendarView: 'month' | 'week' | 'day'
  statsRange: '7' | '30' | '90' | '365' | 'all'
  seenAchievements: string[] | null
  lastLevel: number | null
  /** occurrence keys for which a reminder was already shown */
  remindersShown: string[]
  showHints: boolean
}

const KEY = 'momentum.prefs.v1'

const defaults = (): Prefs => ({
  theme: 'system',
  lang: detectLang(),
  calendarView: 'month',
  statsRange: '30',
  seenAchievements: null,
  lastLevel: null,
  remindersShown: [],
  showHints: true,
})

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...defaults(), ...JSON.parse(raw) }
  } catch {
    /* storage unavailable */
  }
  return defaults()
}

let state: Prefs = load()
const listeners = new Set<() => void>()

export function getPrefs(): Prefs {
  return state
}

export function setPrefs(patch: Partial<Prefs>) {
  state = { ...state, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function usePrefs(): Prefs {
  return useSyncExternalStore(subscribe, getPrefs, getPrefs)
}

/** Resolves the theme preference and applies it to <html data-theme>. */
export function applyTheme(theme: Prefs['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  const root = document.documentElement
  root.dataset.theme = dark ? 'dark' : 'light'
  const color = dark ? '#141310' : '#f6f4ef'
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}
