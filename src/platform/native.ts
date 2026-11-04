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
