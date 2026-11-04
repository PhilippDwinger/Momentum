import { useEffect, useState, useSyncExternalStore } from 'react'

/**
 * PWA integration: service worker registration (via vite-plugin-pwa's virtual module),
 * update prompt, offline-ready signal and the install prompt.
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

interface PwaState {
  needRefresh: boolean
  offlineReady: boolean
  installEvent: BeforeInstallPromptEvent | null
  /** set after a successful install in this session */
  installed: boolean
  update: (() => Promise<void>) | null
}

let state: PwaState = { needRefresh: false, offlineReady: false, installEvent: null, installed: false, update: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

type InstallWindow = Window & { __momentumInstall?: BeforeInstallPromptEvent | null }

export async function initPwa() {
  // the event is captured by an inline script in index.html (it can fire before the app booted)
  const pick = () => {
    const e = (window as InstallWindow).__momentumInstall
    if (e) set({ installEvent: e })
  }
  pick()
  window.addEventListener('momentum-installable', pick)
  window.addEventListener('appinstalled', () => {
    ;(window as InstallWindow).__momentumInstall = null
    set({ installEvent: null, installed: true })
  })
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => set({ needRefresh: true }),
      onOfflineReady: () => set({ offlineReady: true }),
      // look for a new version when the app comes back to the foreground and every 30 min
      onRegisteredSW: (_url, reg) => {
        if (!reg) return
        const check = () => void reg.update().catch(() => {})
        setInterval(check, 30 * 60 * 1000)
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
      },
    })
    set({
      update: async () => {
        const sw = navigator.serviceWorker
        // not controlled yet (very first visit) -> a plain reload already shows the newest version
        if (!sw.controller) return window.location.reload()
        // reload as soon as the new version has taken over (the plugin only does this when the
        // page was already controlled at start), with a fallback
        let done = false
        const reload = () => {
          if (done) return
          done = true
          window.location.reload()
        }
        sw.addEventListener('controllerchange', reload)
        setTimeout(reload, 4000)
        await updateSW(true)
      },
    })
    // installed apps may already be cached from an earlier session
    navigator.serviceWorker.ready.then(() => set({ offlineReady: true })).catch(() => {})
  } catch {
    /* service worker unavailable (e.g. insecure origin) */
  }
}

export function usePwa(): PwaState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/**
 * Shows Chrome's install dialog. Returns 'accepted' | 'dismissed', or 'manual' when the browser
 * offers no dialog right now (then the user installs via the browser menu).
 */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'manual'> {
  const e = state.installEvent
  if (!e) return 'manual'
  // the event can only be used once
  set({ installEvent: null })
  ;(window as InstallWindow).__momentumInstall = null
  try {
    await e.prompt()
    const choice = await e.userChoice
    if (choice.outcome === 'accepted') set({ installed: true })
    return choice.outcome
  } catch {
    return 'manual'
  }
}

export function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true
}

export function useStoragePersisted() {
  const [persisted, setPersisted] = useState<boolean | null>(null)
  useEffect(() => {
    navigator.storage?.persisted?.().then(setPersisted).catch(() => setPersisted(null))
  }, [])
  const request = async () => {
    const ok = await navigator.storage?.persist?.()
    setPersisted(!!ok)
    return !!ok
  }
  return { persisted, request }
}
