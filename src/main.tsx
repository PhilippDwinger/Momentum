import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/manrope'
import '@fontsource-variable/fraunces'
import './styles/base.css'
import './styles/pages.css'
import App from './App'
import { BrandMark } from './components/Icon'
import { OverlayProvider } from './components/Overlays'
import { ensureSeeded, setRepository } from './data/actions'
import { LocalRepository } from './data/repository'
import { initPwa, isStandalone } from './hooks/usePwa'
import { I18nProvider } from './i18n'
import { AppDataProvider } from './state/AppData'
import { applyTheme, usePrefs } from './state/prefs'
import { ToastProvider } from './state/toast'
import { BridgeSync } from './sync/bridge/engine'
import { setBridgeSync } from './sync/bridge/instance'
import { listenForNotificationActions } from './platform/localNotify'
import { DEFAULT_BRIDGE_URL, IS_NATIVE, nativeFetch } from './platform/native'
import { initNativeShell, syncSystemBars } from './platform/shell'
import { initUpdater } from './platform/updater'
import { getPrefs } from './state/prefs'

function Root() {
  const prefs = usePrefs()
  useEffect(() => {
    applyTheme(prefs.theme)
    syncSystemBars()
    document.documentElement.lang = prefs.lang
    if (prefs.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const on = () => {
      applyTheme('system')
      syncSystemBars()
    }
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [prefs.theme, prefs.lang])

  return (
    <I18nProvider lang={prefs.lang}>
      <ToastProvider>
        <AppDataProvider fallback={<Loading />}>
          <OverlayProvider>
            <App />
          </OverlayProvider>
        </AppDataProvider>
      </ToastProvider>
    </I18nProvider>
  )
}

function Loading() {
  return (
    <div className="loading-screen" aria-busy="true">
      <BrandMark size={48} />
    </div>
  )
}

function Fatal({ error }: { error: unknown }) {
  return (
    <div className="loading-screen">
      <div className="empty" style={{ maxWidth: 480 }}>
        <BrandMark size={48} />
        <h3>Momentum konnte den lokalen Speicher nicht öffnen.</h3>
        <p>
          Dein Browser blockiert IndexedDB (z. B. im privaten Modus oder bei deaktivierten Website-Daten). Bitte erlaube
          Website-Daten für diese Seite und lade neu.
        </p>
        <p className="subtle small">{error instanceof Error ? error.message : String(error)}</p>
      </div>
    </div>
  )
}

async function boot() {
  const root = createRoot(document.getElementById('root')!)
  try {
    const repo = await LocalRepository.open()
    setRepository(repo)
    await ensureSeeded()
    // device-to-device sync over Bridge: in the Android app directly (native HTTP, no CORS),
    // in the browser through the Momentum-Host's same-origin proxy
    const sync = new BridgeSync(
      repo,
      IS_NATIVE ? { baseUrl: getPrefs().bridgeUrl || DEFAULT_BRIDGE_URL, fetch: nativeFetch } : { baseUrl: new URL('bridge', document.baseURI).href },
    )
    await sync.load()
    setBridgeSync(sync)
    sync.start()
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void sync.sendPending().catch(() => {})
    })
    if (IS_NATIVE) {
      // registered before rendering so a tap that started the app is not lost
      await listenForNotificationActions((hash) => {
        window.location.hash = hash
      }).catch(() => {})
    } else if (isStandalone()) void navigator.storage?.persist?.()
    root.render(
      <StrictMode>
        <Root />
      </StrictMode>,
    )
    if (IS_NATIVE) {
      void initUpdater()
      void initNativeShell(() => void sync.sendPending().catch(() => {}))
    } else void initPwa()
  } catch (error) {
    root.render(<Fatal error={error} />)
  }
}

void boot()
