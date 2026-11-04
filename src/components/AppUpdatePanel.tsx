import { Download, RefreshCw, Smartphone } from 'lucide-react'
import { useI18n } from '../i18n'
import { APP_BUILD, APP_VERSION, applyUpdateNow, checkForUpdates, openApkDownload, RELEASES_PAGE, useUpdater } from '../platform/updater'

/** Settings section of the Android app: version, automatic updates, APK download. */
export function AppUpdatePanel() {
  const { t } = useI18n()
  const u = useUpdater()
  const busy = u.status === 'checking' || u.status === 'downloading'
  return (
    <section className="settings-group surface" id="app-update">
      <h2>
        <Smartphone size={17} aria-hidden /> {t('app.title')}
      </h2>
      <div className="setting-row">
        <span>{t('app.version', { version: APP_VERSION })}</span>
        <span className="subtle small">{t('app.build', { build: APP_BUILD, native: u.nativeLevel })}</span>
      </div>
      {u.status === 'off' ? (
        <p className="field-hint">{t('app.noUpdates')}</p>
      ) : (
        <>
          <p className="field-hint">{t('app.auto')}</p>
          {u.status === 'checking' && <p className="small">{t('app.status.checking')}</p>}
          {u.status === 'downloading' && <p className="small">{t('app.status.downloading', { version: u.latest?.version ?? '' })}</p>}
          {u.status === 'current' && <p className="small"><span className="badge success">{t('app.status.current')}</span></p>}
          {u.status === 'error' && <p className="field-hint">{t('app.status.error', { message: u.error ?? '' })}</p>}
          {u.status === 'ready' && (
            <div className="hint">
              <div>{t('app.status.ready', { version: u.latest?.version ?? '' })}</div>
              <button className="btn btn-primary btn-sm" onClick={() => void applyUpdateNow()}>
                {t('app.restart')}
              </button>
            </div>
          )}
          {u.nativeAvailable && (
            <div className="hint">
              <div>{t('app.native', { version: u.latest?.version ?? '' })}</div>
              <button className="btn btn-sm" onClick={openApkDownload}>
                <Download size={15} /> {t('app.installApk')}
              </button>
            </div>
          )}
          <div className="button-stack">
            <button className="btn" disabled={busy} onClick={() => void checkForUpdates()}>
              <RefreshCw size={15} className={busy ? 'spin' : ''} /> {t('app.check')}
            </button>
          </div>
          {u.latest?.notes && <p className="field-hint">{t('app.notes', { notes: u.latest.notes })}</p>}
          {RELEASES_PAGE && <p className="field-hint small">{t('app.releases', { url: RELEASES_PAGE })}</p>}
        </>
      )}
    </section>
  )
}
