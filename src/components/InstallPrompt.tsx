import { useState } from 'react'
import { Download, MoreVertical, Smartphone, X } from 'lucide-react'
import { isStandalone, promptInstall, usePwa } from '../hooks/usePwa'
import { useI18n } from '../i18n'
import type { DictKey } from '../i18n/de'
import { IS_NATIVE } from '../platform/native'
import { setPrefs, usePrefs } from '../state/prefs'
import { useToast } from '../state/toast'
import { Modal } from './Modal'

/**
 * Installing the browser app. Chrome's own dialog is used when Chrome offers it; otherwise (it
 * sometimes doesn't, e.g. right after the app was removed) a short guide for the browser menu.
 */

const ua = () => navigator.userAgent
const isIos = () => /iphone|ipad|ipod/i.test(ua())
const isAndroid = () => /android/i.test(ua())

export function canOfferInstall(): boolean {
  return !IS_NATIVE && !isStandalone()
}

function useInstall() {
  const toast = useToast()
  const { t } = useI18n()
  const [guide, setGuide] = useState(false)
  const run = async () => {
    const r = await promptInstall()
    if (r === 'manual') setGuide(true)
    else if (r === 'accepted') toast({ message: t('install.done'), tone: 'success' })
  }
  return { run, guide, closeGuide: () => setGuide(false) }
}

export function InstallButton({ className = 'btn btn-primary btn-sm' }: { className?: string }) {
  const { t } = useI18n()
  const { run, guide, closeGuide } = useInstall()
  return (
    <>
      <button className={className} onClick={() => void run()}>
        <Download size={15} /> {t('settings.install')}
      </button>
      {guide && <InstallGuide onClose={closeGuide} />}
    </>
  )
}

/** Banner on the Today page while Momentum runs in a normal browser tab. */
export function InstallBanner() {
  const { t } = useI18n()
  const prefs = usePrefs()
  const pwa = usePwa()
  const { run, guide, closeGuide } = useInstall()
  const snoozed = prefs.installDismissedAt !== null && Date.now() - prefs.installDismissedAt < 7 * 24 * 3600 * 1000
  if (!canOfferInstall() || pwa.installed || snoozed) return null
  if (!isAndroid() && !isIos() && !pwa.installEvent) return null // desktop: only when Chrome offers it
  return (
    <section className="surface install-banner" aria-label={t('install.title')}>
      <Smartphone size={22} aria-hidden />
      <div className="install-text">
        <strong>{t('install.title')}</strong>
        <span className="subtle small">{t('install.text')}</span>
      </div>
      <button className="btn btn-primary btn-sm" onClick={() => void run()}>
        {t('install.button')}
      </button>
      <button className="icon-btn" aria-label={t('install.later')} onClick={() => setPrefs({ installDismissedAt: Date.now() })}>
        <X size={16} />
      </button>
      {guide && <InstallGuide onClose={closeGuide} />}
    </section>
  )
}

export function InstallGuide({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const steps: DictKey[] = isIos() ? ['install.ios1', 'install.ios2', 'install.ios3'] : isAndroid() ? ['install.android1', 'install.android2', 'install.android3'] : ['install.desktop1', 'install.desktop2']
  return (
    <Modal
      title={t('install.title')}
      icon={<Download size={18} />}
      onClose={onClose}
      footer={
        <button className="btn btn-primary" onClick={onClose}>
          {t('common.done')}
        </button>
      }
    >
      <ol className="install-steps">
        {steps.map((k, i) => (
          <li key={k}>
            {i === 0 && isAndroid() && <MoreVertical size={16} aria-hidden />} {t(k)}
          </li>
        ))}
      </ol>
      {isAndroid() && <p className="field-hint">{t('install.androidNote')}</p>}
    </Modal>
  )
}
