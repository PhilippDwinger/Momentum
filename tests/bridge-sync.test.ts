/// <reference types="node" />
/**
 * Device-to-device sync over Bridge.
 * Runs against an in-memory replica of the Bridge API by default, and against a REAL Bridge
 * server when BRIDGE_TEST_URL is set, e.g. BRIDGE_TEST_URL=http://127.0.0.1:8002 npm test
 */
import { describe, expect, it } from 'vitest'
import * as actions from '../src/data/actions'
import { LocalRepository } from '../src/data/repository'
import { DEFAULT_SETTINGS } from '../src/data/defaults'
import { buildIndex, occurrencesOn, type DataSnapshot } from '../src/domain/occurrences'
import type { Activity, UserSettings } from '../src/domain/types'
import { BridgeSync } from '../src/sync/bridge/engine'
import { deriveGroupKeys, seal, unseal, generateSyncId } from '../src/sync/bridge/crypto'
import { FakeBridge } from './fakeBridge'

const REAL = process.env.BRIDGE_TEST_URL
const label = REAL ? `real Bridge ${REAL}` : 'fake Bridge'
let n = 0

async function snap(repo: LocalRepository): Promise<DataSnapshot> {
  const db = repo.db
  return {
    activities: await db.activities.toArray(),
    categories: await db.categories.toArray(),
    entries: await db.entries.toArray(),
    overrides: await db.overrides.toArray(),
    challenges: await db.challenges.toArray(),
    settings: ((await db.settings.get('settings')) as UserSettings | undefined) ?? DEFAULT_SETTINGS,
  }
}
const names = async (repo: LocalRepository) => buildIndex(await snap(repo)).activities.map((a) => a.name).sort()

const draft = (name: string): actions.ActivityDraft => ({
  name, description: '', icon: 'i:code', color: 'blue', categoryId: null, kind: 'check', unit: '',
  startDate: '2026-11-01', endDate: null, rule: { freq: 'daily', interval: 1 }, target: 1, time: null,
  durationMinutes: null, reminderTime: null, partialCounts: false, notes: '',
})

async function device(fake: FakeBridge | null, nameStr: string) {
  const repo = await LocalRepository.open(`bs-${Date.now()}-${++n}`)
  actions.setRepository(repo)
  await actions.ensureSeeded()
  const sync = new BridgeSync(repo, { baseUrl: REAL ?? fake!.url, fetch: REAL ? undefined : fake!.fetch, autoStart: false })
  await sync.load()
  return { repo, sync, name: nameStr }
}
type Dev = Awaited<ReturnType<typeof device>>

async function add(d: Dev, name: string) {
  actions.setRepository(d.repo)
  return actions.createActivity(draft(name))
}

async function rounds(devs: Dev[], count = 4) {
  for (let i = 0; i < count; i++) for (const d of devs) await d.sync.syncNow()
}

describe(`Bridge sync (${label})`, () => {
  it('encrypts payloads with a key derived from the Sync-ID', async () => {
    const a = await deriveGroupKeys('paddy-geheim-123')
    const b = await deriveGroupKeys('paddy-geheim-123')
    const other = await deriveGroupKeys('jemand-anders')
    expect(a.topic).toBe(b.topic)
    expect(a.topic).not.toBe(other.topic)
    const env = await seal(a.key, { hello: 'Japanisch'.repeat(50) })
    expect(JSON.stringify(env)).not.toContain('Japanisch')
    expect(await unseal(b.key, env)).toEqual({ hello: 'Japanisch'.repeat(50) })
    expect(await unseal(other.key, env)).toBeNull()
    expect(generateSyncId()).toMatch(/^momentum-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/)
  })

  it('a new empty device receives everything, then changes flow both ways', async () => {
    const fake = REAL ? null : new FakeBridge()
    const id = generateSyncId()
    const a = await device(fake, 'PC')
    const b = await device(fake, 'Handy')
    await add(a, 'Japanisch')
    await add(a, 'Lesen')
    await a.sync.configure(id, 'PC')
    await b.sync.configure(id, 'Handy')
    await rounds([a, b])
    expect(await names(b.repo)).toEqual(['Japanisch', 'Lesen'])
    expect(b.sync.getSnapshot().state.pendingChoice).toBeNull()
    // progress on the phone arrives on the PC
    actions.setRepository(b.repo)
    const occ = occurrencesOn(buildIndex(await snap(b.repo)), '2026-11-03').find((o) => o.activityId)!
    await actions.logProgress(occ, 1, '2026-11-03')
    await rounds([a, b])
    expect(buildIndex(await snap(a.repo)).entries.size).toBe(1)
    // delete on the PC removes it on the phone
    actions.setRepository(a.repo)
    const lesen = buildIndex(await snap(a.repo)).activities.find((x) => x.name === 'Lesen')!
    await actions.deleteActivity(lesen)
    await rounds([a, b])
    expect(await names(b.repo)).toEqual(['Japanisch'])
    if (fake) expect(JSON.stringify(fake.sentLog)).not.toContain('Japanisch')
  })

  for (const choice of ['merge', 'theirs', 'mine'] as const) {
    it(`both have data -> user decides: ${choice}`, async () => {
      const fake = REAL ? null : new FakeBridge()
      const id = generateSyncId()
      const a = await device(fake, 'PC')
      const b = await device(fake, 'Handy')
      await add(a, 'Gruppe-A')
      await add(b, 'Handy-B')
      await a.sync.configure(id, 'PC')
      await b.sync.configure(id, 'Handy')
      await rounds([a, b], 2)
      const deciding = [a, b].find((d) => d.sync.getSnapshot().state.pendingChoice)
      expect(deciding, 'one device must ask').toBeTruthy()
      const decidingName = deciding === a ? 'Gruppe-A' : 'Handy-B'
      const otherName = deciding === a ? 'Handy-B' : 'Gruppe-A'
      await deciding!.sync.resolveInitial(choice)
      await rounds([a, b], 6)
      const expected = choice === 'merge' ? [decidingName, otherName].sort() : choice === 'theirs' ? [otherName] : [decidingName]
      expect(await names(a.repo)).toEqual(expected)
      expect(await names(b.repo)).toEqual(expected)
    })
  }

  it('concurrent edits with different content become a conflict the user resolves', async () => {
    const fake = REAL ? null : new FakeBridge()
    const id = generateSyncId()
    const a = await device(fake, 'PC')
    const b = await device(fake, 'Handy')
    const act = await add(a, 'Training')
    await a.sync.configure(id, 'PC')
    await b.sync.configure(id, 'Handy')
    await rounds([a, b], 6)
    // both edit the same activity "offline"
    await a.repo.patch<Activity>('activities', act.id, { name: 'Training (PC)' })
    await b.repo.patch<Activity>('activities', act.id, { name: 'Training (Handy)' })
    await rounds([a, b], 4)
    const conflicts = [...(await a.sync.listConflicts()), ...(await b.sync.listConflicts())]
    expect(conflicts.length).toBeGreaterThanOrEqual(1)
    const holder = (await a.sync.listConflicts()).length ? a : b
    const c = (await holder.sync.listConflicts())[0]
    await holder.sync.resolveConflict(c.id, 'remote')
    await rounds([a, b], 6)
    const na = await names(a.repo)
    expect(na).toEqual(await names(b.repo))
    expect(na[0]).toMatch(/Training \((PC|Handy)\)/)
  })

  it('identical concurrent progress is not a conflict', async () => {
    const fake = REAL ? null : new FakeBridge()
    const id = generateSyncId()
    const a = await device(fake, 'PC')
    const b = await device(fake, 'Handy')
    await add(a, 'Lesen')
    await a.sync.configure(id, 'PC')
    await b.sync.configure(id, 'Handy')
    await rounds([a, b], 6)
    for (const d of [a, b]) {
      actions.setRepository(d.repo)
      const occ = occurrencesOn(buildIndex(await snap(d.repo)), '2026-11-02')[0]
      await actions.logProgress(occ, 1, '2026-11-03')
    }
    await rounds([a, b], 4)
    expect((await a.sync.listConflicts()).length + (await b.sync.listConflicts()).length).toBe(0)
  })

  it('different Sync-IDs never see each other', async () => {
    const fake = REAL ? null : new FakeBridge()
    const a = await device(fake, 'Paddy')
    const b = await device(fake, 'Anna')
    await add(a, 'Nur Paddy')
    await a.sync.configure(generateSyncId(), 'Paddy')
    await b.sync.configure(generateSyncId(), 'Anna')
    await rounds([a, b], 3)
    expect(await names(b.repo)).toEqual([])
    expect(Object.keys(b.sync.getSnapshot().state.peers)).toHaveLength(0)
  })

  it.skipIf(!!REAL)('recovers after a Bridge restart (accounts re-registered with the same identity)', async () => {
    const fake = new FakeBridge()
    const id = generateSyncId()
    const a = await device(fake, 'PC')
    const b = await device(fake, 'Handy')
    await add(a, 'Vorher')
    await a.sync.configure(id, 'PC')
    await b.sync.configure(id, 'Handy')
    await rounds([a, b])
    const ipBefore = b.sync.getSnapshot().state.account!.clientIp
    fake.restart()
    await add(a, 'Nachher')
    // sessions are gone -> next cycles re-login/re-register; errors in between are expected
    for (let i = 0; i < 6; i++) for (const d of [a, b]) await d.sync.syncNow().catch(() => {})
    expect(b.sync.getSnapshot().state.account!.clientIp).toBe(ipBefore)
    expect(await names(b.repo)).toEqual(['Nachher', 'Vorher'])
  })

  it.skipIf(!!REAL)('switching the Bridge server (app setting) registers a new account there and keeps syncing', async () => {
    const one = new FakeBridge()
    const two = new FakeBridge()
    two.url = 'http://other-bridge.test'
    const id = generateSyncId()
    const a = await device(one, 'PC')
    const b = await device(one, 'Handy')
    await add(a, 'Alt')
    await a.sync.configure(id, 'PC')
    await b.sync.configure(id, 'Handy')
    await rounds([a, b])
    const oldIp = b.sync.getSnapshot().state.account!.clientIp
    // the app restarts with the new server address
    const a2 = { ...a, sync: new BridgeSync(a.repo, { baseUrl: two.url, fetch: two.fetch, autoStart: false }) }
    const b2 = { ...b, sync: new BridgeSync(b.repo, { baseUrl: two.url, fetch: two.fetch, autoStart: false }) }
    await a2.sync.load()
    await b2.sync.load()
    expect(b2.sync.getSnapshot().state.account).toBeNull()
    expect(b2.sync.getSnapshot().state.enabled).toBe(true)
    await add(a2, 'Neu')
    await rounds([a2, b2], 6)
    expect(b2.sync.getSnapshot().state.account!.clientIp.startsWith(two.url)).toBe(true)
    expect(b2.sync.getSnapshot().state.account!.clientIp).not.toBe(oldIp)
    expect(await names(b.repo)).toEqual(['Alt', 'Neu'])
  })
})
