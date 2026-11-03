import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { keyToDate, parseKey, weekday as isoWeekday } from '../domain/dates'
import type { Activity, Category, DateKey, RecurrenceRule } from '../domain/types'
import { de, type DictKey } from './de'
import { en } from './en'

export type Lang = 'de' | 'en'
const DICTS = { de, en }

export function detectLang(): Lang {
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'de'
  return nav.toLowerCase().startsWith('de') ? 'de' : nav.toLowerCase().startsWith('en') ? 'en' : 'de'
}

type Params = Record<string, string | number>

function interpolate(s: string, params?: Params) {
  if (!params) return s
  return s.replace(/\{(\w+)\}/g, (_, k) => (params[k] !== undefined ? String(params[k]) : `{${k}}`))
}

export function createI18n(lang: Lang) {
  const dict = DICTS[lang]
  const locale = lang === 'de' ? 'de-DE' : 'en-GB'
  const t = (key: DictKey | string, params?: Params) => interpolate((dict as Record<string, string>)[key] ?? key, params)

  const dtf = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale, opts)
  const fmtLong = dtf({ weekday: 'long', day: 'numeric', month: 'long' })
  const fmtLongYear = dtf({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const fmtMedium = dtf({ weekday: 'short', day: 'numeric', month: 'short' })
  const fmtShort = dtf({ day: 'numeric', month: 'short' })
  const fmtNumeric = dtf({ day: '2-digit', month: '2-digit' })
  const fmtMonthYear = dtf({ month: 'long', year: 'numeric' })
  const fmtMonthShort = dtf({ month: 'short' })
  const fmtWeekdayShort = dtf({ weekday: 'short' })
  const fmtWeekdayLong = dtf({ weekday: 'long' })
  const nf = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 })
  const pf = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
  // 2024-01-01 is a Monday
  const weekdayDate = (wd: number) => new Date(2024, 0, wd, 12)

  const fmt = {
    long: (k: DateKey) => fmtLong.format(keyToDate(k)),
    longYear: (k: DateKey) => fmtLongYear.format(keyToDate(k)),
    medium: (k: DateKey) => fmtMedium.format(keyToDate(k)),
    short: (k: DateKey) => fmtShort.format(keyToDate(k)),
    numeric: (k: DateKey) => fmtNumeric.format(keyToDate(k)),
    monthYear: (k: DateKey) => fmtMonthYear.format(keyToDate(k)),
    monthShort: (k: DateKey) => fmtMonthShort.format(keyToDate(k)),
    weekdayShort: (wd: number) => fmtWeekdayShort.format(weekdayDate(wd)).replace('.', ''),
    weekdayLong: (wd: number) => fmtWeekdayLong.format(weekdayDate(wd)),
    number: (n: number) => nf.format(n),
    percent: (r: number | null) => (r === null ? '–' : pf.format(r)),
    day: (k: DateKey) => String(parseKey(k).d),
  }

  const relative = (k: DateKey, today: DateKey) => {
    if (k === today) return t('common.today')
    const diff = (keyToDate(k).getTime() - keyToDate(today).getTime()) / 86_400_000
    if (Math.round(diff) === -1) return t('common.yesterday')
    if (Math.round(diff) === 1) return t('common.tomorrow')
    return fmt.medium(k)
  }

  const describeRule = (rule: RecurrenceRule, anchor: DateKey) => {
    const n = rule.interval
    const days = (rule.weekdays?.length ? rule.weekdays : [isoWeekday(anchor)]) as number[]
    switch (rule.freq) {
      case 'once':
        return t('rule.once', { date: fmt.short(anchor) })
      case 'daily':
        return n === 1 ? t('rule.daily') : t('rule.everyDays', { n })
      case 'weekly': {
        if (n === 1 && days.length === 7) return t('rule.daily')
        if (n === 1 && days.join() === '1,2,3,4,5') return t('rule.weekdays')
        if (n === 1 && days.join() === '6,7') return t('rule.weekend')
        const list = days.map(fmt.weekdayShort).join(', ')
        return n === 1 ? t('rule.weekly', { days: list }) : t('rule.everyWeeks', { n, days: list })
      }
      case 'monthly': {
        if (rule.monthlyMode === 'weekday') {
          const nth = t(`editor.nth.${rule.nth ?? 1}`)
          const weekday = fmt.weekdayLong(rule.nthWeekday ?? 1)
          return n === 1 ? t('rule.monthlyWeekday', { nth, weekday }) : t('rule.everyMonthsWeekday', { n, nth, weekday })
        }
        const day = rule.monthDay ?? parseKey(anchor).d
        return n === 1 ? t('rule.monthlyDay', { day }) : t('rule.everyMonthsDay', { n, day })
      }
    }
  }

  const unitOf = (a: Pick<Activity, 'kind' | 'unit'>) => (a.kind === 'duration' ? t('common.min') : a.kind === 'check' ? '' : a.unit)
  const amount = (a: Pick<Activity, 'kind' | 'unit'>, value: number) => {
    const u = unitOf(a)
    return u ? `${nf.format(value)} ${u}` : nf.format(value)
  }
  const categoryName = (c: Category | undefined | null) => (c ? c.name || (c.builtin ? t(`cat.${c.builtin}`) : '') : '')

  return { lang, locale, t, fmt, relative, describeRule, unitOf, amount, categoryName }
}

export type I18n = ReturnType<typeof createI18n>

const I18nContext = createContext<I18n>(createI18n('de'))

export function I18nProvider({ lang, children }: { lang: Lang; children: ReactNode }) {
  const value = useMemo(() => createI18n(lang), [lang])
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

export function useI18n(): I18n {
  return useContext(I18nContext)
}
