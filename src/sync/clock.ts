/**
 * Identifiers and logical time.
 *
 * - `uuidv7()` – time-ordered random UUIDs for user-created records (activities, categories).
 * - `HybridClock` – hybrid logical clock (HLC). Every local change gets a version string
 *   `<wallMs:15>:<counter:4 base36>:<deviceId>`. Versions are lexicographically comparable,
 *   monotonic per device and stay ordered even if a device clock drifts slightly.
 *   Last-writer-wins conflict resolution compares these strings.
 */

export function uuidv7(now: number = Date.now()): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  let ts = now
  for (let i = 5; i >= 0; i--) {
    bytes[i] = ts % 256
    ts = Math.floor(ts / 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function randomDeviceId(): string {
  const bytes = new Uint8Array(6)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface HlcParts {
  ms: number
  counter: number
  node: string
}

export function formatHlc({ ms, counter, node }: HlcParts): string {
  return `${String(ms).padStart(15, '0')}:${counter.toString(36).padStart(4, '0')}:${node}`
}

export function parseHlc(value: string): HlcParts | null {
  const m = /^(\d{15}):([0-9a-z]{4}):([\w-]+)$/.exec(value)
  if (!m) return null
  return { ms: Number(m[1]), counter: parseInt(m[2], 36), node: m[3] }
}

export class HybridClock {
  private last: HlcParts
  private readonly now: () => number
  readonly node: string

  constructor(node: string, now: () => number = Date.now) {
    this.node = node
    this.now = now
    this.last = { ms: 0, counter: 0, node }
  }

  /** Version for a new local change. */
  tick(): string {
    const wall = this.now()
    if (wall > this.last.ms) this.last = { ms: wall, counter: 0, node: this.node }
    else this.last = { ms: this.last.ms, counter: this.last.counter + 1, node: this.node }
    return formatHlc(this.last)
  }

  /** Merge a version observed from elsewhere (remote record, persisted state). */
  receive(version: string | null | undefined): void {
    if (!version) return
    const r = parseHlc(version)
    if (!r) return
    if (r.ms > this.last.ms || (r.ms === this.last.ms && r.counter > this.last.counter)) {
      this.last = { ms: r.ms, counter: r.counter, node: this.node }
    }
  }

  get current(): string {
    return formatHlc(this.last)
  }
}

/** -1 / 0 / 1 comparison of two versions (string order = causal order). */
export function compareVersions(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}
