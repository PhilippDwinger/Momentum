/** Pure helpers of the Android platform layer (unit-tested, no Capacitor imports). */

/** Validates a Bridge server address; returns it without trailing slash or null. */
export function normalizeBridgeUrl(raw: string): string | null {
  const v = raw.trim()
  if (!v) return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.origin}${u.pathname}`.replace(/\/+$/, '')
  } catch {
    return null
  }
}

/** 31-bit positive id from the plan item id (Android notification ids are Java ints). */
export function notificationId(key: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 1) || 1
}
