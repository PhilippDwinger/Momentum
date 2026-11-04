import { useEffect, useRef, useState } from 'react'
import { Download, HardDrive, Keyboard, MonitorSmartphone, Trash2, Upload } from 'lucide-react'
import { PushSettings, SyncSettings } from '../components/SyncPanels'
import { deviceTimeZone } from '../domain/dates'
import { deleteAllData, updateSettings } from '../data/actions'
import { buildExport, downloadFile, occurrencesCsv } from '../data/exportImport'
import type { UserSettings } from '../domain/types'
import { isStandalone, usePwa, useStoragePersisted } from '../hooks/usePwa'
import { AppUpdatePanel } from '../components/AppUpdatePanel'
import { IS_NATIVE } from '../platform/native'
import { useI18n, type Lang } from '../i18n'
import { useAppData } from '../state/AppData'
import { applyTheme, setPrefs, usePrefs, type Prefs } from '../state/prefs'
import { useToast } from '../state/toast'
import { useUI } from '../state/uiContext'

const APP_VERSION = '1.2.0'

const timeZones: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
  } catch {
    return []
  }
})()

export function SettingsPage() {
  const { index, today } = useAppData()
  const { t, categoryName } = useI18n()
  const prefs = usePrefs()
  const toast = useToast()
  const ui = useUI()
  const pwa = usePwa()
  const storage = useStoragePersisted()
  const fileRef = useRef<HTMLInputElement>(null)
  const s = index.settings
  const [name, setName] = useState(s.name)

  useEffect(() => setName(s.name), [s.name])

  const save = (patch: Partial<UserSettings>) => void updateSettings(s, patch)
  const setTheme = (theme: Prefs['theme']) => {
    setPrefs({ theme })
    applyTheme(theme)
  }

  const onImportFile = async (file: File) => {
    const { parseImport, ImportError } = await import('../data/importParse')
    try {
      const parsed = parseImport(await file.text())
      ui.open({ type: 'import', parsed })
    } catch (e) {
      const code = e instanceof ImportError ? e.code : 'format'
      toast({ message: t(`settings.importError.${code}`), tone: 'error' })
    }
  }

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent)

  return (
    <div className="page page-narrow settings">
      <header className="page-head">
        <h1 className="page-title">{t('settings.title')}</h1>
      </header>

      <section className="settings-group surface">
        <h2>{t('settings.profile')}</h2>
        <div className="field">
          <label htmlFor="set-name">{t('settings.name')}</label>
          <input
            id="set-name"
            className="input"
            value={name}
            maxLength={40}
            placeholder={t('settings.namePlaceholder')}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name !== s.name && save({ name: name.trim() })}
          />
        </div>
      </section>

      <section className="settings-group surface">
        <h2>{t('settings.appearance')}</h2>
        <div className="setting-row">
          <span>{t('settings.theme')}</span>
          <div className="seg" role="group" aria-label={t('settings.theme')}>
            {(['system', 'light', 'dark'] as const).map((th) => (
              <button key={th} aria-pressed={prefs.theme === th} onClick={() => setTheme(th)}>
                {t(`settings.theme.${th}`)}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <span>{t('settings.language')}</span>
          <div className="seg" role="group" aria-label={t('settings.language')}>
            {(['de', 'en'] as Lang[]).map((l) => (
              <button key={l} aria-pressed={prefs.lang === l} onClick={() => { setPrefs({ lang: l }); document.documentElement.lang = l }}>
                {l === 'de' ? 'Deutsch' : 'English'}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group surface">
        <h2>{t('settings.behavior')}</h2>
        <div className="setting-row">
          <label htmlFor="set-daystart">
            {t('settings.dayStart')}
            <small className="field-hint">{t('settings.dayStartHint')}</small>
          </label>
          <select id="set-daystart" className="select select-sm" value={s.dayStartHour} onChange={(e) => save({ dayStartHour: Number(e.target.value) })}>
            {[0, 1, 2, 3, 4, 5, 6].map((h) => (
              <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <label htmlFor="set-tz">
            {t('tz.label')}
            <small className="field-hint">{t('tz.hint')}</small>
          </label>
          <select id="set-tz" className="select select-sm tz-select" value={s.timeZone} onChange={(e) => save({ timeZone: e.target.value })}>
            <option value="">{t('tz.auto', { zone: deviceTimeZone() })}</option>
            {timeZones.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="setting-row">
          <span>{t('settings.weekStart')}</span>
          <div className="seg" role="group" aria-label={t('settings.weekStart')}>
            {([1, 0] as const).map((w) => (
              <button key={w} aria-pressed={s.weekStartsOn === w} onClick={() => save({ weekStartsOn: w })}>
                {new Intl.DateTimeFormat(prefs.lang, { weekday: 'long' }).format(new Date(2024, 0, w === 1 ? 1 : 7, 12))}
              </button>
            ))}
          </div>
        </div>
        <label className="switch">
          <span className="switch-text">
            {t('settings.streakProtection')}
            <small>{t('settings.streakProtectionHint')}</small>
          </span>
          <input type="checkbox" checked={s.streakProtection} onChange={(e) => save({ streakProtection: e.target.checked })} />
        </label>
        <div className="setting-row">
          <label htmlFor="set-overload">{t('settings.overload')}</label>
          <select id="set-overload" className="select select-sm" value={s.overloadThreshold} onChange={(e) => save({ overloadThreshold: Number(e.target.value) })}>
            {[3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
              <option key={n} value={n}>{t('settings.overloadValue', { count: n + 1 })}</option>
            ))}
          </select>
        </div>
        <label className="switch">
          <span className="switch-text">{t('settings.motivation')}</span>
          <input type="checkbox" checked={s.showMotivation} onChange={(e) => save({ showMotivation: e.target.checked })} />
        </label>
      </section>

      <PushSettings />

      <SyncSettings />

      <section className="settings-group surface">
        <h2><HardDrive size={17} aria-hidden /> {t('settings.data')}</h2>
        <div className="button-stack">
          <button className="btn" onClick={async () => downloadFile(`momentum-backup-${today}.json`, await buildExport(), 'application/json')}>
            <Download size={16} /> {t('settings.exportJson')}
          </button>
          <button className="btn" onClick={() => downloadFile(`momentum-history-${today}.csv`, occurrencesCsv(index, today, (id) => categoryName(index.categoryById.get(id ?? ''))), 'text/csv')}>
            <Download size={16} /> {t('settings.exportCsv')}
          </button>
          <button className="btn" onClick={() => fileRef.current?.click()}>
            <Upload size={16} /> {t('settings.import')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (f) void onImportFile(f)
            }}
          />
        </div>
        {!IS_NATIVE && (
          <p className="field-hint" style={{ marginTop: 12 }}>
            {storage.persisted ? t('settings.storagePersisted') : t('settings.storageBestEffort')}
          </p>
        )}
        {!IS_NATIVE && storage.persisted === false && (
          <button className="btn btn-sm" style={{ marginTop: 8 }} onClick={() => void storage.request()}>
            {t('settings.storageRequest')}
          </button>
        )}
        <hr className="divider" />
        <button
          className="btn btn-danger"
          onClick={async () => {
            const ok = await ui.confirm({ title: t('settings.deleteAll'), message: t('settings.deleteAllConfirm'), confirmLabel: t('common.delete'), danger: true })
            if (!ok) return
            await deleteAllData()
            setPrefs({ seenAchievements: null, lastLevel: null })
            toast({ message: t('settings.deleteAllDone') })
          }}
        >
          <Trash2 size={16} /> {t('settings.deleteAll')}
        </button>
      </section>

      {IS_NATIVE ? (
        <AppUpdatePanel />
      ) : (
      <section className="settings-group surface">
        <h2><MonitorSmartphone size={17} aria-hidden /> {t('settings.app')}</h2>
        {isStandalone() ? (
          <p className="small">{t('settings.installed')}</p>
        ) : pwa.installEvent ? (
          <div className="setting-row">
            <span className="field-hint">{t('settings.installHint')}</span>
            <button className="btn btn-primary btn-sm" onClick={() => void pwa.installEvent?.prompt()}>
              {t('settings.install')}
            </button>
          </div>
        ) : ios ? (
          <p className="field-hint">{t('settings.installIos')}</p>
        ) : (
          <p className="field-hint">{t('settings.installHint')}</p>
        )}
        {pwa.offlineReady && <p className="small" style={{ marginTop: 8 }}><span className="badge success">{t('settings.offlineReady')}</span></p>}
        <div className="setting-row" style={{ marginTop: 8 }}>
          <span className="subtle small">{t('settings.version', { version: APP_VERSION })}</span>
          <button className="btn btn-ghost btn-sm hide-mobile" onClick={() => ui.open({ type: 'shortcuts' })}>
            <Keyboard size={15} /> {t('settings.shortcuts')}
          </button>
        </div>
      </section>
      )}
    </div>
  )
}
