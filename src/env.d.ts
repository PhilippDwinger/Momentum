/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Bridge server used by the Android app (default: Paddy's server). */
  readonly VITE_BRIDGE_URL?: string
  /** Set by CI for app builds, e.g. "1.2.17". */
  readonly VITE_APP_VERSION?: string
  /** CI build number (monotonic) – compared with latest.json. */
  readonly VITE_APP_BUILD?: string
  /** URL of latest.json in the newest GitHub release. */
  readonly VITE_UPDATE_URL?: string
  /** Web page of the GitHub releases (shown in the app). */
  readonly VITE_RELEASES_PAGE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
