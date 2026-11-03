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
  update: (() => Promise<void>) | null
}

let state: PwaState = { needRefresh: false, offlineReady: false, installEvent: null, update: null }
const listeners = new Set<() => void>()
const set = (patch: Partial<PwaState>) => {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export async function initPwa() {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    set({ installEvent: e as BeforeInstallPromptEvent })
  })
  window.addEventListener('appinstalled', () => set({ installEvent: null }))
  if (!('serviceWorker' in navigator) || import.meta.env.DEV) return
  try {
    const { registerSW } = await import('virtual:pwa-register')
    const updateSW = registerSW({
      immediate: true,
      onNeedRefresh: () => set({ needRefresh: true }),
      onOfflineReady: () => set({ offlineReady: true }),
    })
    set({ update: () => updateSW(true) })
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
