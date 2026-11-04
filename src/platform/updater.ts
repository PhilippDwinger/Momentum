import { CapacitorHttp } from '@capacitor/core'
import { useSyncExternalStore } from 'react'
import { IS_NATIVE } from './native'
import { decideUpdate, nativeLevelFromVersionCode, parseLatest, type LatestInfo } from './updateLogic'

/**
 * Self-update of the Android app from GitHub Releases.
 * - web bundle: downloaded silently (checksum-verified) and activated when the app goes to the
 *   background or is reopened; a broken bundle is rolled back automatically (notifyAppReady).
 * - APK: only needed when the native shell changes – the app offers the download.
 */

export const APP_VERSION = import.meta.env.VITE_APP_VERSION || '1.2.0-dev'
export const APP_BUILD = Number(import.meta.env.VITE_APP_BUILD || 0)
const UPDATE_URL = import.meta.env.VITE_UPDATE_URL || ''
export const RELEASES_PAGE = import.meta.env.VITE_RELEASES_PAGE || ''

export type UpdaterStatus = 'off' | 'idle' | 'checking' | 'downloading' | 'ready' | 'current' | 'error'

export interface UpdaterState {
  status: UpdaterStatus
  nativeLevel: number
  nativeVersion: string
  latest: LatestInfo | null
  nativeAvailable: boolean
  readyBuild: number | null
  readyId: string | null
  error: string | null
  checkedAt: number
}

let state: UpdaterState = {
  status: IS_NATIVE && UPDATE_URL ? 'idle' : 'off',
  nativeLevel: 0,
  nativeVersion: '',
  latest: null,
  nativeAvailable: false,
  readyBuild: null,
  readyId: null,
  error: null,
  checkedAt: 0,
}
const listeners = new Set<() => void>()
function set(patch: Partial<UpdaterState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

export function useUpdater(): UpdaterState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

const updater = () => import('@capgo/capacitor-updater').then((m) => m.CapacitorUpdater)

export async function initUpdater(): Promise<void> {
  if (!IS_NATIVE) return
  // tells the updater this bundle started fine (otherwise it rolls back after 15 s)
  await (await updater()).notifyAppReady().catch(() => {})
  const { App } = await import('@capacitor/app')
  const info = await App.getInfo().catch(() => null)
  set({ nativeLevel: nativeLevelFromVersionCode(Number(info?.build ?? 0)), nativeVersion: info?.version ?? '' })
  if (!UPDATE_URL) return
  setTimeout(() => void checkForUpdates(), 4000)
  void App.addListener('resume', () => {
    if (Date.now() - state.checkedAt > 30 * 60 * 1000) void checkForUpdates()
  })
}

let running: Promise<void> | null = null

export function checkForUpdates(): Promise<void> {
  if (!IS_NATIVE || !UPDATE_URL) return Promise.resolve()
  if (!running) running = doCheck().finally(() => (running = null))
  return running
}

async function doCheck() {
  if (state.status !== 'ready') set({ status: 'checking', error: null })
  try {
    const r = await CapacitorHttp.get({
      url: `${UPDATE_URL}?t=${Date.now()}`,
      headers: { 'cache-control': 'no-cache' },
      responseType: 'json',
      connectTimeout: 15_000,
      readTimeout: 30_000,
    })
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`)
    const latest = parseLatest(r.data)
    if (!latest) throw new Error('latest.json ungültig')
    const d = decideUpdate(latest, { build: APP_BUILD, nativeLevel: state.nativeLevel })
    set({ latest, nativeAvailable: d.native, checkedAt: Date.now() })
    if (!d.web || state.readyBuild === latest.build) {
      if (state.status !== 'ready') set({ status: 'current' })
      return
    }
    set({ status: 'downloading' })
    const u = await updater()
    const version = String(latest.build)
    const { bundles } = await u.list()
    let bundle = bundles.find((b) => b.version === version && b.status === 'success')
    if (!bundle) bundle = await u.download({ url: latest.web, version, checksum: latest.sha256 })
    // activated when the app goes to the background or is restarted
    await u.next({ id: bundle.id })
    set({ status: 'ready', readyBuild: latest.build, readyId: bundle.id })
  } catch (e) {
    set({ status: state.readyId ? 'ready' : 'error', error: e instanceof Error ? e.message : String(e), checkedAt: Date.now() })
  }
}

/** Restart into the downloaded version right away. */
export async function applyUpdateNow(): Promise<void> {
  if (!state.readyId) return
  await (await updater()).set({ id: state.readyId })
}

/** Opens the APK download in the phone's browser (Android then offers to install it). */
export function openApkDownload() {
  const url = state.latest?.apk || RELEASES_PAGE
  if (url) window.location.href = url
}
