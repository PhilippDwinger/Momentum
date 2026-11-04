import { describe, expect, it } from 'vitest'
import { normalizeBridgeUrl, notificationId } from '../src/platform/helpers'
import { decideUpdate, nativeLevelFromVersionCode, parseLatest, versionCodeFor } from '../src/platform/updateLogic'

const sha = 'a'.repeat(64)
const latest = (over: Record<string, unknown> = {}) => ({
  version: '1.2.12',
  build: 12,
  native: 1,
  minNative: 1,
  web: 'https://github.com/x/momentum/releases/download/build-12/web.zip',
  apk: 'https://github.com/x/momentum/releases/download/build-12/Momentum.apk',
  sha256: sha,
  ...over,
})

describe('app updates', () => {
  it('encodes the native level in the versionCode', () => {
    expect(versionCodeFor(1, 12)).toBe(100012)
    expect(nativeLevelFromVersionCode(100012)).toBe(1)
    expect(nativeLevelFromVersionCode(2_000_345)).toBe(20)
    expect(nativeLevelFromVersionCode(NaN)).toBe(0)
  })

  it('validates latest.json', () => {
    expect(parseLatest(latest())).not.toBeNull()
    expect(parseLatest(JSON.stringify(latest()))).not.toBeNull()
    expect(parseLatest('kaputt')).toBeNull()
    expect(parseLatest(latest({ web: 'http://insecure/web.zip' }))).toBeNull()
    expect(parseLatest(latest({ sha256: 'xyz' }))).toBeNull()
    expect(parseLatest(latest({ build: -1 }))).toBeNull()
    expect(parseLatest(latest({ notes: 'x'.repeat(900) }))!.notes!.length).toBe(500)
  })

  it('newer web bundle for the same shell is installed silently', () => {
    expect(decideUpdate(parseLatest(latest())!, { build: 10, nativeLevel: 1 })).toEqual({ web: true, native: false })
    expect(decideUpdate(parseLatest(latest())!, { build: 12, nativeLevel: 1 })).toEqual({ web: false, native: false })
    expect(decideUpdate(parseLatest(latest())!, { build: 14, nativeLevel: 1 })).toEqual({ web: false, native: false })
  })

  it('a bundle that needs a newer shell is not installed – the APK is offered instead', () => {
    expect(decideUpdate(parseLatest(latest({ native: 2, minNative: 2 }))!, { build: 10, nativeLevel: 1 })).toEqual({ web: false, native: true })
    // new shell, but the bundle still runs on the old one
    expect(decideUpdate(parseLatest(latest({ native: 2, minNative: 1 }))!, { build: 10, nativeLevel: 1 })).toEqual({ web: true, native: true })
  })
})

describe('platform helpers', () => {
  it('normalizes Bridge addresses', () => {
    expect(normalizeBridgeUrl(' https://muttchen.tail91b057.ts.net:8443/ ')).toBe('https://muttchen.tail91b057.ts.net:8443')
    expect(normalizeBridgeUrl('http://192.168.0.5:8002')).toBe('http://192.168.0.5:8002')
    expect(normalizeBridgeUrl('ftp://x')).toBeNull()
    expect(normalizeBridgeUrl('kein link')).toBeNull()
    expect(normalizeBridgeUrl('')).toBeNull()
  })

  it('maps plan ids to stable positive 31-bit notification ids', () => {
    const ids = new Set<number>()
    for (let d = 1; d <= 30; d++) for (const k of ['m', 'e', 'r:act1', 'r:act2']) ids.add(notificationId(`2026-11-${String(d).padStart(2, '0')}:${k}`))
    expect(ids.size).toBe(120)
    for (const id of ids) expect(id > 0 && id <= 0x7fffffff && Number.isInteger(id)).toBe(true)
    expect(notificationId('x')).toBe(notificationId('x'))
  })
})
