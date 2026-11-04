/**
 * Pure update decisions for the Android app (unit-tested).
 *
 * Every push to GitHub builds a release with `latest.json`, the web bundle (`web.zip`) and the
 * APK. The installed APK has a "native level" (encoded in its versionCode); web bundles only
 * run on shells with at least `minNative`. Normal changes arrive silently as a new web bundle;
 * only a higher native level needs a new APK.
 */

export interface LatestInfo {
  version: string
  build: number
  native: number
  minNative: number
  web: string
  sha256: string
  apk: string
  notes?: string
  date?: string
}

const NATIVE_FACTOR = 100_000

export function versionCodeFor(nativeLevel: number, build: number): number {
  return nativeLevel * NATIVE_FACTOR + build
}

export function nativeLevelFromVersionCode(code: number): number {
  return Number.isFinite(code) && code > 0 ? Math.floor(code / NATIVE_FACTOR) : 0
}

const isPosInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0
const isHttps = (v: unknown): v is string => typeof v === 'string' && /^https:\/\/\S+$/.test(v)

export function parseLatest(raw: unknown): LatestInfo | null {
  const o = typeof raw === 'string' ? safeJson(raw) : raw
  if (!o || typeof o !== 'object') return null
  const r = o as Record<string, unknown>
  if (typeof r.version !== 'string' || !isPosInt(r.build) || !isPosInt(r.native) || !isPosInt(r.minNative)) return null
  if (!isHttps(r.web) || !isHttps(r.apk) || typeof r.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(r.sha256)) return null
  return {
    version: r.version,
    build: r.build,
    native: r.native,
    minNative: r.minNative,
    web: r.web,
    sha256: r.sha256,
    apk: r.apk,
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 500) : undefined,
    date: typeof r.date === 'string' ? r.date : undefined,
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

export interface UpdateDecision {
  /** download + activate the newer web bundle */
  web: boolean
  /** a newer APK exists that this shell needs for the newest features */
  native: boolean
}

export function decideUpdate(latest: LatestInfo, current: { build: number; nativeLevel: number }): UpdateDecision {
  return {
    web: latest.build > current.build && latest.minNative <= current.nativeLevel,
    native: latest.native > current.nativeLevel,
  }
}
