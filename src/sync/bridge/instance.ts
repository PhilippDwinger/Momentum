import { useSyncExternalStore } from 'react'
import type { BridgeSync, SyncSnapshot } from './engine'

/** App-wide engine instance + React hook. */
let engine: BridgeSync | null = null
const noop = () => () => {}

export function setBridgeSync(e: BridgeSync) {
  engine = e
}

export function getBridgeSync(): BridgeSync | null {
  return engine
}

export function useBridgeSync(): SyncSnapshot | null {
  return useSyncExternalStore(
    engine ? (fn) => engine!.subscribe(fn) : noop,
    () => engine?.getSnapshot() ?? null,
  )
}

export interface HostInfo {
  app: 'momentum-host'
  version: string
  bridge: string
  push: { publicKey: string; dryRun?: boolean }
}

let hostCache: { at: number; info: HostInfo | null } | null = null

/** Info of the Momentum-Host serving this app (null when the app is served by something else). */
export async function getHostInfo(force = false): Promise<HostInfo | null> {
  if (!force && hostCache && Date.now() - hostCache.at < 60_000) return hostCache.info
  let info: HostInfo | null
  try {
    const r = await fetch(new URL('momentum-host/info', document.baseURI).href, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
    const data = r.ok ? await r.json() : null
    info = data?.app === 'momentum-host' ? data : null
  } catch {
    info = null
  }
  hostCache = { at: Date.now(), info }
  return info
}

export async function hostPost<T = unknown>(path: string, body: unknown): Promise<T> {
  const r = await fetch(new URL(`momentum-host/${path}`, document.baseURI).href, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${r.status}`)
  return data as T
}
