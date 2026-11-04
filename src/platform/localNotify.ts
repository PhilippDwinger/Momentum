import type { PlanItem } from '../domain/notifications'
import { notificationId } from './helpers'
import { IS_NATIVE } from './native'

/**
 * Notifications in the Android app: the plan (with the motivational texts) is scheduled on the
 * phone itself as exact alarms, so it works without any server and with the app closed.
 * Rescheduled whenever data changes, on app start/resume and every 30 min while open.
 */

const CHANNEL = 'momentum'
const ACTION_TYPE = 'MOMENTUM_OCC'
const MAX_SCHEDULED = 150

const plugin = () => import('@capacitor/local-notifications').then((m) => m.LocalNotifications)

let prepared: string | null = null

async function prepare(lang: 'de' | 'en') {
  if (prepared === lang) return
  const ln = await plugin()
  await ln
    .createChannel({
      id: CHANNEL,
      name: 'Momentum',
      description: lang === 'de' ? 'Erinnerungen und Motivation' : 'Reminders and motivation',
      importance: 4,
      visibility: 1,
      vibration: true,
      lights: true,
      lightColor: '#D4532C',
    })
    .catch(() => {})
  await ln.registerActionTypes({
    types: [
      {
        id: ACTION_TYPE,
        actions: [
          { id: 'done', title: lang === 'de' ? 'Erledigt ✓' : 'Done ✓' },
          { id: 'open', title: lang === 'de' ? 'Öffnen' : 'Open' },
        ],
      },
    ],
  })
  prepared = lang
}

export type LocalPermission = 'granted' | 'denied' | 'prompt'

export async function localPermission(): Promise<LocalPermission> {
  if (!IS_NATIVE) return 'denied'
  const p = await (await plugin()).checkPermissions()
  return p.display === 'granted' ? 'granted' : p.display === 'denied' ? 'denied' : 'prompt'
}

export async function requestLocalPermission(): Promise<boolean> {
  const p = await (await plugin()).requestPermissions()
  return p.display === 'granted'
}

/** Exact alarms ("Wecker & Erinnerungen") – granted automatically on most phones. */
export async function exactAlarmsGranted(): Promise<boolean> {
  try {
    const r = await (await plugin()).checkExactNotificationSetting()
    return r.exact_alarm === 'granted'
  } catch {
    return true
  }
}

export async function openExactAlarmSettings() {
  await (await plugin()).changeExactNotificationSetting().catch(() => {})
}

async function cancelOurs() {
  const ln = await plugin()
  const pending = await ln.getPending()
  if (pending.notifications.length) await ln.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) })
}

export async function scheduleLocalPlan(items: PlanItem[], lang: 'de' | 'en'): Promise<number> {
  await prepare(lang)
  const ln = await plugin()
  const exact = await exactAlarmsGranted()
  const now = Date.now()
  const list = items
    .filter((it) => it.at > now + 5000)
    .sort((a, b) => a.at - b.at)
    .slice(0, MAX_SCHEDULED)
  await cancelOurs()
  if (list.length === 0) return 0
  await ln.schedule({
    notifications: list.map((it) => ({
      id: notificationId(it.id),
      title: it.title,
      body: it.body,
      largeBody: it.body,
      schedule: { at: new Date(it.at), allowWhileIdle: true },
      // never pop up the system settings during automatic rescheduling
      isExactNotification: exact,
      channelId: CHANNEL,
      smallIcon: 'ic_stat_momentum',
      iconColor: '#D4532C',
      actionTypeId: it.occKey ? ACTION_TYPE : undefined,
      group: it.kind,
      extra: { url: it.url, occKey: it.occKey ?? null },
    })),
  })
  return list.length
}

export async function cancelLocalPlan() {
  if (IS_NATIVE) await cancelOurs().catch(() => {})
}

export async function sendLocalTest(title: string, body: string, lang: 'de' | 'en') {
  await prepare(lang)
  await (await plugin()).schedule({
    notifications: [
      {
        id: 1,
        title,
        body,
        largeBody: body,
        schedule: { at: new Date(Date.now() + 1500), allowWhileIdle: true },
        isExactNotification: false,
        channelId: CHANNEL,
        smallIcon: 'ic_stat_momentum',
        iconColor: '#D4532C',
      },
    ],
  })
}

/** Taps and the "Erledigt" button lead into the app (registered once at start). */
export async function listenForNotificationActions(navigate: (hash: string) => void) {
  if (!IS_NATIVE) return
  const ln = await plugin()
  await ln.addListener('localNotificationActionPerformed', (e) => {
    const extra = (e.notification.extra ?? {}) as { url?: string; occKey?: string | null }
    if (e.actionId === 'done' && extra.occKey) navigate(`#/today?done=${encodeURIComponent(extra.occKey)}`)
    else if (extra.url) navigate(extra.url.replace(/^\.\//, '').replace(/^[^#]*/, '') || '#/today')
  })
}
