import { IS_NATIVE } from './native'

/**
 * Android shell behaviour: hardware back button, status/navigation bar icon colours that follow
 * the app theme, and "app came back to the foreground" hooks.
 */

export async function initNativeShell(onResume: () => void) {
  if (!IS_NATIVE) return
  const { App } = await import('@capacitor/app')
  await App.addListener('backButton', ({ canGoBack }) => {
    // 1. close the topmost dialog / sheet
    const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')
    const top = dialogs[dialogs.length - 1]
    if (top) {
      top.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
      return
    }
    // 2. go back inside the app, 3. on the start page leave the app (keeps it in memory)
    const onStart = !location.hash || location.hash === '#/' || location.hash.startsWith('#/today')
    if (canGoBack && !onStart) history.back()
    else if (!onStart) location.hash = '#/today'
    else void App.minimizeApp()
  })
  await App.addListener('resume', onResume)
  syncSystemBars()
}

/** Light icons on the dark theme, dark icons on the light theme. */
export function syncSystemBars() {
  if (!IS_NATIVE) return
  const dark = document.documentElement.dataset.theme === 'dark'
  void import('@capacitor/core').then(({ SystemBars, SystemBarsStyle }) =>
    SystemBars.setStyle({ style: dark ? SystemBarsStyle.Dark : SystemBarsStyle.Light }).catch(() => {}),
  )
}
