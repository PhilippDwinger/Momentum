/**
 * End-to-end protection for sync messages. Everything a device sends through Bridge is
 * compressed + AES-GCM encrypted with a key derived from the Sync-ID. Bridge (and other users
 * on the same Bridge) only see ciphertext; the topic name is a hash, not the ID itself.
 */

const enc = new TextEncoder()
const dec = new TextDecoder()

export interface GroupKeys {
  /** Topic in Bridge's public realm used to find the other devices of this group. */
  topic: string
  /** Opaque group id (also used as push group at the Momentum-Host). */
  groupId: string
  key: CryptoKey
}

export interface Envelope {
  m: 'mom1'
  iv: string
  d: string
  z?: 1
}

function toB64(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

async function hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(data))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export function normalizeSyncId(id: string): string {
  return id.trim().replace(/\s+/g, ' ')
}

export async function deriveGroupKeys(syncId: string): Promise<GroupKeys> {
  const id = normalizeSyncId(syncId)
  const h = await hex(`momentum|group|${id}`)
  const base = await crypto.subtle.importKey('raw', enc.encode(id), 'PBKDF2', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: enc.encode('momentum-sync-v1'), iterations: 120_000, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return { topic: `momentum.${h.slice(0, 32)}`, groupId: `g${h.slice(32, 56)}`, key }
}

const canCompress = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined'

async function pipe(data: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const blob = new Blob([data as BlobPart])
  const out = await new Response(blob.stream().pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>)).arrayBuffer()
  return new Uint8Array(out)
}

export async function seal(key: CryptoKey, payload: unknown): Promise<Envelope> {
  let bytes: Uint8Array = enc.encode(JSON.stringify(payload))
  const z = canCompress && bytes.length > 256
  if (z) bytes = await pipe(bytes, new CompressionStream('deflate-raw'))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes as BufferSource))
  return z ? { m: 'mom1', iv: toB64(iv), d: toB64(cipher), z: 1 } : { m: 'mom1', iv: toB64(iv), d: toB64(cipher) }
}

/** Returns the payload, or null if the message is not ours / was tampered with. */
export async function unseal(key: CryptoKey, env: unknown): Promise<unknown | null> {
  if (!env || typeof env !== 'object') return null
  const e = env as Partial<Envelope>
  if (e.m !== 'mom1' || typeof e.iv !== 'string' || typeof e.d !== 'string') return null
  try {
    let bytes: Uint8Array = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(e.iv) as BufferSource }, key, fromB64(e.d) as BufferSource))
    if (e.z) {
      if (!canCompress) return null
      bytes = await pipe(bytes, new DecompressionStream('deflate-raw'))
    }
    return JSON.parse(dec.decode(bytes))
  } catch {
    return null
  }
}

/** Size of the envelope as Bridge will count it (JSON text bytes). */
export function envelopeSize(env: Envelope): number {
  return JSON.stringify(env).length + 2
}

/** A readable, hard-to-guess Sync-ID, e.g. "momentum-k7m3-xq9p-r2dw-h8tz". */
export function generateSyncId(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')
  return `momentum-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`
}
