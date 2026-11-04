import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Android app (Capacitor). The web build (`npm run build:app`) is bundled into the APK; later
 * versions arrive as live updates of the web bundle from GitHub Releases (see
 * `src/platform/updater.ts` and `.github/workflows/android.yml`).
 */
const config: CapacitorConfig = {
  appId: 'de.paddy.momentum',
  appName: 'Momentum',
  webDir: 'dist',
  android: {
    allowMixedContent: false,
  },
  plugins: {
    CapacitorUpdater: {
      // self-hosted, manual flow: the app downloads bundles from GitHub Releases itself
      autoUpdate: false,
      statsUrl: '',
      appReadyTimeout: 15000,
      resetWhenUpdate: true,
      autoDeleteFailed: true,
      autoDeletePrevious: true,
      responseTimeout: 60,
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_momentum',
      iconColor: '#d4532c',
    },
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
}

export default config
