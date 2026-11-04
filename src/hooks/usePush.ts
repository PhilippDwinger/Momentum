import { useEffect, useRef } from 'react'
import { getRepository } from '../data/actions'
import { buildNotificationPlan } from '../domain/notifications'
import { useI18n } from '../i18n'
import type { AppData } from '../state/AppData'
import { getPrefs, setPrefs, usePrefs } from '../state/prefs'
import { getBridgeSync, getHostInfo, hostPost } from '../sync/bridge/instance'
import { cancelLocalPlan, requestLocalPermission, scheduleLocalPlan, sendLocalTest } from '../platform/localNotify'
import { IS_NATIVE } from '../platform/native'

/**
 * Notifications.
 * - Android app: scheduled on the phone itself (see platform/localNotify.ts) – no server.
 * - Browser: Web Push via the Momentum-Host. The device generates its notification plan (motivational
 * texts included) from the current data and uploads it; the host delivers each item on time,
 * also when the app is closed. Every device of a sync group uploads for the whole group, so a
 * reminder disappears everywhere once it is done on any device.
 */

export type PushAvailability = 'ok' | 'unsupported' | 'insecure'

export function pushAvailability(): PushAvailability {
  if (IS_NATIVE) return 'ok'
  if (!window.isSecureContext) return 'insecure'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported'
  return 'ok'
}

/** Push group: the sync group if sync is on, otherwise this device alone. */
export function currentPushGroup(): string {
  const g = getBridgeSync()?.groupId
  const s = getBridgeSync()?.getSnapshot().state
  return s?.enabled && g ? g : `d${getRepository().deviceId}`
}

function keyToBytes(base64: string): Uint8Array {
  const pad = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, (c) => c.charCodeAt(0))
}

export async function enablePush(label: string): Promise<void> {
  if (IS_NATIVE) {
    if (!(await requestLocalPermission())) throw new Error('denied')
    setPrefs({ pushEnabled: true, pushGroup: null })
    return
  }
  if (pushAvailability() !== 'ok') throw new Error(pushAvailability())
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('denied')
  const info = await getHostInfo(true)
  if (!info) throw new Error('no-host')
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (sub) {
    // the host may have new VAPID keys (fresh data folder) – resubscribe if the key differs
    const current = sub.options.applicationServerKey ? new Uint8Array(sub.options.applicationServerKey) : null
    const wanted = keyToBytes(info.push.publicKey)
    if (!current || current.length !== wanted.length || current.some((b, i) => b !== wanted[i])) {
      await sub.unsubscribe()
      sub = null
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(info.push.publicKey) as BufferSource })
  const group = currentPushGroup()
  await hostPost('push/subscribe', { group, device: getRepository().deviceId, subscription: sub.toJSON(), label })
  setPrefs({ pushEnabled: true, pushGroup: group })
}

export async function disablePush(): Promise<void> {
  if (IS_NATIVE) {
    await cancelLocalPlan()
    setPrefs({ pushEnabled: false, pushGroup: null, pushPlanned: 0 })
    return
  }
  const prefs = getPrefs()
  try {
    const reg = await navigator.serviceWorker.ready
    await (await reg.pushManager.getSubscription())?.unsubscribe()
  } catch {
    /* ignore */
  }
  if (prefs.pushGroup) await hostPost('push/unsubscribe', { group: prefs.pushGroup, device: getRepository().deviceId }).catch(() => {})
  setPrefs({ pushEnabled: false, pushGroup: null })
}

export async function sendTestPush(title: string, body: string, lang: 'de' | 'en' = 'de'): Promise<number> {
  if (IS_NATIVE) {
    await sendLocalTest(title, body, lang)
    return 1
  }
  const r = await hostPost<{ delivered: number }>('push/test', { group: currentPushGroup(), device: getRepository().deviceId, title, body })
  return r.delivered
}

/** Keeps the host's plan for this group up to date. */
export function usePushPlanner(data: AppData) {
  const prefs = usePrefs()
  const { lang, amount } = useI18n()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!prefs.pushEnabled) return
    const plan = (horizonDays: number) =>
      buildNotificationPlan({
        index: data.index,
        streaks: data.game.streaks,
        now: new Date(),
        today: data.today,
        timeZone: data.timeZone,
        lang,
        helpers: { lang, amount },
        xpToNext: data.game.level.span - data.game.level.intoLevel,
        nextLevel: data.game.level.level + 1,
        horizonDays,
      })
    const upload = async () => {
      if (IS_NATIVE) {
        // on the phone: a week ahead, so reminders keep coming even if the app stays closed
        const n = await scheduleLocalPlan(plan(7), lang)
        setPrefs({ pushPlanned: n, pushPlannedAt: Date.now() })
        return
      }
      const group = currentPushGroup()
      const device = getRepository().deviceId
      // sync group changed since subscribing -> move the subscription
      if (prefs.pushGroup && prefs.pushGroup !== group) {
        await enablePush('').catch(() => {})
      }
      const items = plan(3)
      await hostPost('push/plan', { group, device, items })
      setPrefs({ pushPlanned: items.length, pushPlannedAt: Date.now() })
    }
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void upload().catch(() => {}), 2500)
    const periodic = setInterval(() => void upload().catch(() => {}), 30 * 60 * 1000)
    let resume: { remove: () => Promise<void> } | null = null
    let cancelled = false
    if (IS_NATIVE) {
      void import('@capacitor/app').then(({ App }) =>
        App.addListener('resume', () => void upload().catch(() => {})).then((h) => {
          if (cancelled) void h.remove()
          else resume = h
        }),
      )
    }
    return () => {
      cancelled = true
      if (timer.current) clearTimeout(timer.current)
      clearInterval(periodic)
      void resume?.remove()
    }
  }, [data, prefs.pushEnabled, prefs.pushGroup, lang, amount])
}
