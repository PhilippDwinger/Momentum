import { useEffect } from 'react'
import { parseTime, zonedParts } from '../domain/dates'
import { isDone, isPlanned, occurrencesOn } from '../domain/occurrences'
import { useI18n } from '../i18n'
import type { AppData } from '../state/AppData'
import { getPrefs, setPrefs } from '../state/prefs'
import { IS_NATIVE } from '../platform/native'

/**
 * Local reminders. Without a push server, notifications can only be shown while the app (or
 * its tab) is running – this is a platform limitation and documented in the README.
 * Each occurrence is notified at most once (tracked in device-local prefs).
 */
export function useReminders(data: AppData, active = true) {
  const { t } = useI18n()
  useEffect(() => {
    // the Android app schedules real notifications instead (platform/localNotify.ts)
    if (!active || IS_NATIVE || !('Notification' in window)) return
    const check = async () => {
      if (Notification.permission !== 'granted') return
      const p = zonedParts(new Date(), data.timeZone)
      const minutes = p.hour * 60 + p.minute
      const shown = new Set(getPrefs().remindersShown)
      const due = occurrencesOn(data.index, data.today).filter((o) => {
        const a = data.index.activityById.get(o.activityId)
        const at = parseTime(a?.reminderTime)
        return a && at !== null && at <= minutes && minutes - at < 120 && isPlanned(o) && !isDone(o) && !shown.has(`${data.today}|${o.key}`)
      })
      if (due.length === 0) return
      const reg = await navigator.serviceWorker?.getRegistration?.().catch(() => undefined)
      for (const o of due) {
        const a = data.index.activityById.get(o.activityId)!
        const title = t('toast.reminder', { name: a.name })
        const options: NotificationOptions = { body: a.description || t('app.tagline'), tag: o.key, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }
        try {
          if (reg) await reg.showNotification(title, options)
          else new Notification(title, options)
        } catch {
          /* ignore */
        }
        shown.add(`${data.today}|${o.key}`)
      }
      // keep the list small: only today's keys matter
      setPrefs({ remindersShown: [...shown].filter((k) => k.startsWith(`${data.today}|`)) })
    }
    void check()
    const timer = setInterval(() => void check(), 30_000)
    return () => clearInterval(timer)
  }, [data, t, active])
}
