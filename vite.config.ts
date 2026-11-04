/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

const BRIDGE_URL = process.env.BRIDGE_URL || 'https://muttchen.tail91b057.ts.net:8443'
const HOST_URL = process.env.MOMENTUM_HOST_URL || 'http://127.0.0.1:5180'
function devProxy() {
  return {
    '/bridge': { target: BRIDGE_URL, changeOrigin: true, secure: false, rewrite: (p: string) => p.replace(/^\/bridge/, '') },
    '/momentum-host': { target: HOST_URL, changeOrigin: true },
  }
}

// https://vite.dev/config/
// `vite build --mode app` = web bundle for the Android app (no service worker; see capacitor.config.ts)
export default defineConfig(({ mode }) => ({
  // Relative base so the build works from any sub-path (e.g. static hosting, Bridge later).
  base: './',
  plugins: [
    react(),
    VitePWA({
      disable: mode === 'app',
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: './',
        name: 'Momentum – Habits & Planer',
        short_name: 'Momentum',
        description: 'Persönlicher Planer für Gewohnheiten, Routinen und Ziele. Funktioniert offline.',
        lang: 'de',
        start_url: './',
        scope: './',
        display: 'standalone',
        display_override: ['standalone', 'minimal-ui'],
        orientation: 'any',
        background_color: '#f6f4ef',
        theme_color: '#f6f4ef',
        categories: ['productivity', 'lifestyle', 'health'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icons/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
        ],
        shortcuts: [
          { name: 'Heute', short_name: 'Heute', url: './#/today' },
          { name: 'Kalender', short_name: 'Kalender', url: './#/calendar' },
        ],
      },
      workbox: {
        // Only the static app shell is cached. User data lives in IndexedDB and is never
        // put into the HTTP cache.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        globIgnores: ['**/*-cyrillic*', '**/*-greek*', '**/*-vietnamese*'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
        runtimeCaching: [],
        // push + notification click handling (public/push-sw.js)
        importScripts: ['push-sw.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  // Dev/preview: forward the Bridge + host APIs like the Momentum-Host does (Bridge sends no CORS headers)
  server: { proxy: devProxy() },
  preview: { proxy: devProxy() },
  build: {
    // single app chunk (~170 kB gzip) is precached by the service worker anyway
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
  },
}))
