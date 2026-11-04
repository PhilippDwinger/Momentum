import { useEffect, useState } from 'react'
import { BellRing, Cloud, CloudOff, Copy, Eye, EyeOff, RefreshCw, Shuffle, TriangleAlert } from 'lucide-react'
import { updateSettings } from '../data/actions'
import type { SyncConflict } from '../data/db'
import type { NotifyTone } from '../domain/types'
import { disablePush, enablePush, pushAvailability, sendTestPush } from '../hooks/usePush'
import { useI18n } from '../i18n'
import { useAppData } from '../state/AppData'
import { usePrefs } from '../state/prefs'
import { useToast } from '../state/toast'
import { useUI } from '../state/uiContext'
import { generateSyncId } from '../sync/bridge/crypto'
import type { InitialChoice } from '../sync/bridge/engine'
import { getBridgeSync, getHostInfo, useBridgeSync, type HostInfo } from '../sync/bridge/instance'
import { exactAlarmsGranted, localPermission, openExactAlarmSettings, type LocalPermission } from '../platform/localNotify'
import { DEFAULT_BRIDGE_URL, IS_NATIVE, normalizeBridgeUrl } from '../platform/native'
import { setPrefs } from '../state/prefs'
import { Modal } from './Modal'

/** Momentum-Host info (browser only – the Android app needs no host). */
function useHost(): HostInfo | null | undefined {
  const [info, setInfo] = useState<HostInfo | null | undefined>(undefined)
  useEffect(() => {
    if (!IS_NATIVE) void getHostInfo().then(setInfo)
  }, [])
  return info
}

/** Bridge server of the Android app (direct connection). Changing it restarts the app. */
function BridgeServerField() {
  const { t } = useI18n()
  const prefs = usePrefs()
  const toast = useToast()
  const current = prefs.bridgeUrl || DEFAULT_BRIDGE_URL
  const [value, setValue] = useState(current)
  return (
    <div className="field">
      <label htmlFor="sync-server">{t('sync.server')}</label>
      <div className="input-group">
        <input id="sync-server" className="input" value={value} onChange={(e) => setValue(e.target.value)} inputMode="url" autoComplete="off" spellCheck={false} />
        <button
          type="button"
          className="btn"
          disabled={value.trim() === current}
          onClick={() => {
            const url = normalizeBridgeUrl(value)
            if (!url) {
              toast({ message: t('sync.serverInvalid'), tone: 'error' })
              return
            }
            setPrefs({ bridgeUrl: url === DEFAULT_BRIDGE_URL ? null : url })
            window.location.reload()
          }}
        >
          {t('sync.serverSave')}
        </button>
      </div>
      <span className="field-hint">{t('sync.serverHint')}</span>
    </div>
  )
}

function ago(ms: number, lang: string): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' })
  if (s < 60) return rtf.format(-s, 'second')
  if (s < 3600) return rtf.format(-Math.round(s / 60), 'minute')
  if (s < 86400) return rtf.format(-Math.round(s / 3600), 'hour')
  return rtf.format(-Math.round(s / 86400), 'day')
}

export function SyncSettings() {
  const { t, lang } = useI18n()
  const snap = useBridgeSync()
  const host = useHost()
  const toast = useToast()
  const ui = useUI()
  const engine = getBridgeSync()
  const [syncId, setSyncId] = useState('')
  const [deviceName, setDeviceName] = useState(() => (/android|iphone|ipad/i.test(navigator.userAgent) ? 'Handy' : 'PC'))
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  if (!engine || !snap) return null
  const s = snap.state
  const on = s.enabled
  const statusTone = snap.status === 'online' ? 'success' : snap.status === 'error' || snap.status === 'choice' ? 'warning' : ''
  const peers = Object.values(s.peers).sort((a, b) => b.lastSeen - a.lastSeen)

  const start = async () => {
    setBusy(true)
    try {
      await engine.configure(syncId, deviceName)
      toast({ message: t('sync.started') })
    } catch (e) {
      toast({ message: t('toast.error', { message: e instanceof Error ? e.message : String(e) }), tone: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-group surface" id="sync">
      <h2>
        {on ? <Cloud size={17} aria-hidden /> : <CloudOff size={17} aria-hidden />} {t('sync.title')}
        <span className={`badge ${statusTone}`} style={{ marginLeft: 'auto' }}>
          {t(`sync.status.${snap.status}`)}
        </span>
      </h2>
      <p className="field-hint">{t('sync.intro')}</p>
      {IS_NATIVE && <BridgeServerField />}
      {!IS_NATIVE && host === null && <p className="hint small">{t('sync.noHost')}</p>}
      {host && <p className="field-hint">{t('sync.host', { url: host.bridge })}</p>}

      {!on ? (
        <form
          className="sync-form"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <div className="field">
            <label htmlFor="sync-id">{t('sync.id')}</label>
            <div className="input-group">
              <input id="sync-id" className="input" value={syncId} onChange={(e) => setSyncId(e.target.value)} placeholder={t('sync.idPlaceholder')} autoComplete="off" spellCheck={false} />
              <button type="button" className="btn" onClick={() => setSyncId(generateSyncId())}>
                <Shuffle size={15} /> {t('sync.generate')}
              </button>
            </div>
            <span className="field-hint">{t('sync.idHint')}</span>
          </div>
          <div className="field">
            <label htmlFor="sync-device">{t('sync.deviceName')}</label>
            <input id="sync-device" className="input" value={deviceName} onChange={(e) => setDeviceName(e.target.value)} placeholder={t('sync.deviceNamePlaceholder')} maxLength={40} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy || syncId.trim().length < 4 || (!IS_NATIVE && host === null)}>
            {t('sync.start')}
          </button>
        </form>
      ) : (
        <>
          <div className="setting-row">
            <span>{t('sync.id')}</span>
            <span className="input-group">
              <code>{reveal ? s.syncId : '•'.repeat(Math.min(16, s.syncId.length))}</code>
              <button className="icon-btn" onClick={() => setReveal((x) => !x)} aria-label={reveal ? t('sync.hide') : t('sync.show')}>
                {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
              <button
                className="icon-btn"
                aria-label={t('sync.copy')}
                onClick={() => {
                  void navigator.clipboard?.writeText(s.syncId).then(() => toast({ message: t('sync.copied') }))
                }}
              >
                <Copy size={16} />
              </button>
            </span>
          </div>
          <div className="field">
            <label htmlFor="sync-device2">{t('sync.deviceName')}</label>
            <input id="sync-device2" className="input" defaultValue={s.deviceName} maxLength={40} onBlur={(e) => e.target.value !== s.deviceName && void engine.setDeviceName(e.target.value)} />
          </div>
          <div>
            <span className="field-label">{t('sync.peers')}</span>
            {peers.length === 0 ? (
              <p className="field-hint">{t('sync.noPeers')}</p>
            ) : (
              <ul className="peer-list">
                {peers.map((p) => (
                  <li key={p.id}>
                    <span className={`dot ${Date.now() - p.lastSeen < 15 * 60 * 1000 ? 'live' : ''}`} />
                    <strong>{p.name || p.id.slice(0, 6)}</strong>
                    <span className="subtle small">{p.lastSeen ? t('sync.lastSeen', { time: ago(p.lastSeen, lang) }) : '–'}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {snap.conflicts > 0 && (
            <div className="hint">
              <TriangleAlert size={18} aria-hidden />
              <div>{t('sync.conflicts', { count: snap.conflicts })}</div>
              <button className="btn btn-sm" onClick={() => ui.open({ type: 'conflicts' })}>
                {t('sync.resolve')}
              </button>
            </div>
          )}
          <div className="setting-row">
            <label htmlFor="sync-policy">{t('sync.policy')}</label>
            <select id="sync-policy" className="select select-sm" value={s.conflictPolicy} onChange={(e) => void engine.setConflictPolicy(e.target.value as 'ask' | 'newest')}>
              <option value="ask">{t('sync.policy.ask')}</option>
              <option value="newest">{t('sync.policy.newest')}</option>
            </select>
          </div>
          <p className="field-hint">
            {s.lastSyncAt ? t('sync.lastSync', { time: ago(s.lastSyncAt, lang) }) : ''}
            {snap.pending > 0 ? ` · ${t('sync.pending', { count: snap.pending })}` : ''}
          </p>
          {s.lastError && snap.status !== 'online' && <p className="field-hint">{t('sync.error', { message: s.lastError })}</p>}
          <div className="button-stack">
            <button
              className="btn"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                await engine.syncNow().catch((e) => toast({ message: t('toast.error', { message: e instanceof Error ? e.message : String(e) }), tone: 'error' }))
                setBusy(false)
              }}
            >
              <RefreshCw size={15} className={busy ? 'spin' : ''} /> {t('sync.now')}
            </button>
            {snap.status === 'choice' && (
              <button className="btn btn-primary" onClick={() => ui.open({ type: 'syncChoice' })}>
                {t('choice.title')}
              </button>
            )}
            <button
              className="btn btn-danger"
              onClick={async () => {
                if (await ui.confirm({ title: t('sync.stop'), message: t('sync.stopConfirm'), confirmLabel: t('sync.stop'), danger: true })) await engine.disable()
              }}
            >
              {t('sync.stop')}
            </button>
          </div>
        </>
      )}
    </section>
  )
}

export function PushSettings() {
  const { t, lang } = useI18n()
  const { index } = useAppData()
  const prefs = usePrefs()
  const host = useHost()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const s = index.settings
  const avail = pushAvailability()
  const [nativePerm, setNativePerm] = useState<LocalPermission | null>(null)
  const [exact, setExact] = useState(true)
  useEffect(() => {
    if (!IS_NATIVE) return
    const refresh = () => {
      void localPermission().then(setNativePerm).catch(() => {})
      void exactAlarmsGranted().then(setExact)
    }
    refresh()
    let h: { remove: () => Promise<void> } | null = null
    let gone = false
    void import('@capacitor/app').then(({ App }) =>
      App.addListener('resume', refresh).then((x) => {
        if (gone) void x.remove()
        else h = x
      }),
    )
    return () => {
      gone = true
      void h?.remove()
    }
  }, [])
  const denied = IS_NATIVE ? nativePerm === 'denied' : 'Notification' in window && Notification.permission === 'denied'
  const needsHost = !IS_NATIVE && host === null
  const save = (patch: Partial<typeof s>) => void updateSettings(s, patch)

  const toggle = async () => {
    setBusy(true)
    try {
      if (prefs.pushEnabled) await disablePush()
      else {
        await enablePush(getBridgeSync()?.getSnapshot().state.deviceName || navigator.platform || 'Gerät')
        await sendTestPush('Momentum', t('push.testBody'), lang).catch(() => 0)
      }
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      toast({ message: m === 'denied' ? t('push.denied') : m === 'no-host' ? t('sync.noHost') : t('push.failed', { message: m }), tone: 'error', duration: 7000 })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="settings-group surface" id="push">
      <h2>
        <BellRing size={17} aria-hidden /> {t('push.title')}
        {prefs.pushEnabled && <span className="badge success" style={{ marginLeft: 'auto' }}>{t('push.on')}</span>}
      </h2>
      <p className="field-hint">{IS_NATIVE ? t('push.introApp') : t('push.intro')}</p>
      {avail === 'insecure' && <p className="hint small">{t('push.insecure')}</p>}
      {avail === 'unsupported' && <p className="hint small">{t('push.unsupported')}</p>}
      {denied && <p className="hint small">{IS_NATIVE ? t('push.deniedApp') : t('push.denied')}</p>}
      {needsHost && avail === 'ok' && <p className="hint small">{t('sync.noHost')}</p>}
      {IS_NATIVE && prefs.pushEnabled && !exact && (
        <div className="hint">
          <div>{t('push.exact')}</div>
          <button className="btn btn-sm" onClick={() => void openExactAlarmSettings()}>
            {t('push.exactButton')}
          </button>
        </div>
      )}
      <div className="button-stack">
        <button className={`btn ${prefs.pushEnabled ? '' : 'btn-primary'}`} disabled={busy || avail !== 'ok' || needsHost} onClick={() => void toggle()}>
          {prefs.pushEnabled ? t('push.disable') : t('push.enable')}
        </button>
        {prefs.pushEnabled && (
          <button
            className="btn"
            onClick={async () => {
              const n = await sendTestPush('Momentum', t('push.testBody'), lang).catch(() => 0)
              toast({ message: n > 0 ? t('push.testSent') : t('push.failed', { message: '0' }), tone: n > 0 ? 'success' : 'error' })
            }}
          >
            {t('push.test')}
          </button>
        )}
      </div>
      {prefs.pushEnabled && prefs.pushPlanned !== null && <p className="field-hint">{t('push.planned', { count: prefs.pushPlanned })}</p>}
      <div className="setting-row">
        <label htmlFor="push-morning">{t('push.morning')}</label>
        <input id="push-morning" className="input input-sm" type="time" value={s.notifyMorning} onChange={(e) => save({ notifyMorning: e.target.value })} />
      </div>
      <div className="setting-row">
        <label htmlFor="push-evening">{t('push.evening')}</label>
        <input id="push-evening" className="input input-sm" type="time" value={s.notifyEvening} onChange={(e) => save({ notifyEvening: e.target.value })} />
      </div>
      <div className="setting-row">
        <span>{t('push.tone')}</span>
        <div className="seg" role="group" aria-label={t('push.tone')}>
          {(['gentle', 'motivating', 'intense'] as NotifyTone[]).map((tone) => (
            <button key={tone} aria-pressed={s.notifyTone === tone} onClick={() => save({ notifyTone: tone })}>
              {t(`push.tone.${tone}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="field-hint">{t('push.reminderHint')}</p>
    </section>
  )
}

export function SyncChoiceDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const ui = useUI()
  const snap = useBridgeSync()
  const engine = getBridgeSync()
  const [busy, setBusy] = useState(false)
  const pending = snap?.state.pendingChoice
  if (!engine || !pending) return null
  const run = async (c: InitialChoice) => {
    if (c !== 'merge') {
      const ok = await ui.confirm({ title: t('choice.title'), message: t(c === 'mine' ? 'choice.confirmMine' : 'choice.confirmTheirs'), confirmLabel: t('common.confirm'), danger: true })
      if (!ok) return
    }
    setBusy(true)
    await engine.resolveInitial(c)
    setBusy(false)
    onClose()
  }
  const sum = (x: { activities: number; entries: number }) => t('choice.summary', x)
  return (
    <Modal title={t('choice.title')} onClose={onClose} size="narrow">
      <p className="muted" style={{ marginBottom: 12 }}>{t('choice.text', { peer: pending.peerName || '?' })}</p>
      <div className="compare-sides">
        <div>
          <span className="kpi-label">{t('choice.mine')}</span>
          <strong>{sum(pending.mine)}</strong>
        </div>
        <div>
          <span className="kpi-label">{t('choice.theirs', { peer: pending.peerName || '?' })}</span>
          <strong>{sum(pending.theirs)}</strong>
        </div>
      </div>
      <div className="scope-options" style={{ marginTop: 14 }}>
        <button className="scope-option" disabled={busy} onClick={() => void run('merge')} data-autofocus>
          <strong>{t('choice.merge')}</strong>
          <span>{t('choice.mergeHint')}</span>
        </button>
        <button className="scope-option" disabled={busy} onClick={() => void run('theirs')}>
          <strong>{t('choice.takeTheirs')}</strong>
          <span>{t('choice.takeTheirsHint')}</span>
        </button>
        <button className="scope-option danger" disabled={busy} onClick={() => void run('mine')}>
          <strong>{t('choice.takeMine')}</strong>
          <span>{t('choice.takeMineHint')}</span>
        </button>
      </div>
    </Modal>
  )
}

export function ConflictsDialog({ onClose }: { onClose: () => void }) {
  const { t, fmt } = useI18n()
  const { index } = useAppData()
  const snap = useBridgeSync()
  const engine = getBridgeSync()
  const [list, setList] = useState<SyncConflict[]>([])
  useEffect(() => {
    void engine?.listConflicts().then(setList)
  }, [engine, snap?.conflicts])
  if (!engine) return null

  const describe = (c: SyncConflict, r: Record<string, unknown>) => {
    if (r.deletedAt) return t('conflict.deleted')
    if (c.table === 'activities') return String(r.name ?? '')
    if (c.table === 'entries') {
      const a = index.activityById.get(String(r.activityId))
      return `${a?.name ?? '?'} · ${fmt.short(String(r.date))} · ${r.value}${r.note ? ` · „${r.note}“` : ''}`
    }
    if (c.table === 'categories') return String(r.name || r.builtin || '')
    return c.id.split(':')[1]?.slice(0, 12) ?? ''
  }

  return (
    <Modal
      title={t('conflict.title')}
      onClose={onClose}
      footer={
        list.length > 1 ? (
          <button className="btn" onClick={() => void engine.resolveAll('newest')}>
            {t('conflict.allNewest')}
          </button>
        ) : undefined
      }
    >
      <p className="muted small" style={{ marginBottom: 12 }}>{t('conflict.text')}</p>
      {list.length === 0 ? (
        <p className="subtle">{t('conflict.none')}</p>
      ) : (
        <ul className="conflict-list">
          {list.map((c) => (
            <li key={c.id} className="surface">
              <span className="eyebrow">{t(`conflict.table.${c.table}`)}</span>
              <div className="compare-sides">
                <div>
                  <span className="kpi-label">{t('conflict.thisDevice')}</span>
                  <span>{describe(c, c.local)}</span>
                </div>
                <div>
                  <span className="kpi-label">{t('conflict.other', { peer: c.peerName || '?' })}</span>
                  <span>{describe(c, c.remote)}</span>
                </div>
              </div>
              <div className="button-stack">
                <button className="btn btn-sm" onClick={() => void engine.resolveConflict(c.id, 'local')}>
                  {t('conflict.keepMine')}
                </button>
                <button className="btn btn-sm" onClick={() => void engine.resolveConflict(c.id, 'remote')}>
                  {t('conflict.takeOther')}
                </button>
                {c.table === 'entries' && (
                  <button className="btn btn-sm" onClick={() => void engine.resolveConflict(c.id, 'combine')}>
                    {t('conflict.combine')}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** Opens the initial-choice dialog automatically when a decision is needed. */
export function SyncWatcher() {
  const snap = useBridgeSync()
  const ui = useUI()
  const status = snap?.status
  const [shownFor, setShownFor] = useState<string | null>(null)
  const peerId = snap?.state.pendingChoice?.peerId ?? null
  useEffect(() => {
    if (status === 'choice' && peerId && shownFor !== peerId) {
      setShownFor(peerId)
      ui.open({ type: 'syncChoice' })
    }
  }, [status, peerId, shownFor, ui])
  return null
}
