import { Capacitor, CapacitorHttp } from '@capacitor/core'
import type { FetchLike } from '../sync/bridge/api'

export { normalizeBridgeUrl } from './helpers'

/**
 * Android app (Capacitor) vs. browser. In the app there is no Momentum-Host: the app talks to
 * Bridge directly through Android's native HTTP stack (Bridge sends no CORS headers, so the
 * WebView's fetch could not read its answers) and schedules notifications on the phone itself.
 */
export const IS_NATIVE = Capacitor.isNativePlatform()

export const DEFAULT_BRIDGE_URL = import.meta.env.VITE_BRIDGE_URL || 'https://muttchen.tail91b057.ts.net:8443'

/** Where the browser app should open so it can talk to Bridge directly. */
export const BROWSER_APP_URL = `${DEFAULT_BRIDGE_URL}/momentum/`

export type BridgeMode = 'native' | 'direct' | 'proxy'

/**
 * How this copy of Momentum reaches Bridge:
 * - native: Android app, native HTTP (no CORS)
 * - direct: browser app opened under Bridge's own address (…:8443/momentum/) – same origin
 * - proxy:  browser app opened elsewhere (e.g. http://localhost:5180) – via the Momentum-Host
 */
export function bridgeConnection(configured: string | null): { mode: BridgeMode; base: string; server: string } {
  const server = configured || DEFAULT_BRIDGE_URL
  if (IS_NATIVE) return { mode: 'native', base: server, server }
  let origin = ''
  try {
    origin = new URL(server).origin
  } catch {
    /* invalid -> proxy */
  }
  if (origin && origin === window.location.origin) return { mode: 'direct', base: origin, server }
  return { mode: 'proxy', base: new URL('bridge', document.baseURI).href, server }
}

let connection: ReturnType<typeof bridgeConnection> | null = null
export const setConnection = (c: ReturnType<typeof bridgeConnection>) => (connection = c)
export const getConnection = () => connection

/** fetch() replacement for the Bridge client that uses the native HTTP stack (no CORS). */
export const nativeFetch: FetchLike = async (input, init) => {
  const headers: Record<string, string> = {}
  if (init?.headers && typeof init.headers === 'object' && !Array.isArray(init.headers) && !(init.headers instanceof Headers)) {
    Object.assign(headers, init.headers as Record<string, string>)
  }
  let data: unknown
  if (typeof init?.body === 'string') {
    try {
      data = JSON.parse(init.body)
    } catch {
      data = init.body
    }
  }
  const r = await CapacitorHttp.request({
    url: input,
    method: init?.method ?? 'GET',
    headers,
    data,
    connectTimeout: 15_000,
    // long-poll waits up to 20 s on the server
    readTimeout: 45_000,
    responseType: 'json',
  })
  const body = r.status === 204 || r.data === undefined || r.data === null || r.data === '' ? null : typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
  return new Response(body, { status: r.status, headers: { 'content-type': 'application/json' } })
}
