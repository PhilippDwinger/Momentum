# Android-App

Momentum läuft auf dem Handy als Capacitor-App (`android/`, App-ID `de.paddy.momentum`). Die
Oberfläche ist derselbe Web-Code wie im Browser (`npm run build:app` = Vite-Build ohne Service
Worker); dazu kommen drei native Bausteine:

| Baustein | Paket | Wofür |
|---|---|---|
| Native HTTP | `CapacitorHttp` (Core) | Bridge-Aufrufe ohne CORS (`src/platform/native.ts → nativeFetch`) |
| Lokale Benachrichtigungen | `@capacitor/local-notifications` | Plan der nächsten 7 Tage als exakte Alarme (`src/platform/localNotify.ts`) |
| Live-Updates | `@capgo/capacitor-updater` (selbst gehostet, ohne Capgo-Cloud) | neues Web-Bundle von GitHub Releases (`src/platform/updater.ts`) |
| App-Lebenszyklus | `@capacitor/app` | Zurück-Taste, Resume, Versionsinfo (`src/platform/shell.ts`) |

Kein Momentum-Host nötig: Die App spricht direkt mit Bridge
(`https://muttchen.tail91b057.ts.net:8443`, in den Sync-Einstellungen änderbar).

## Build & Release (GitHub Actions)

`.github/workflows/android.yml` läuft bei jedem Push auf `master`/`main` (außer reinen Doku-/Host-Änderungen):

1. `npm ci`, Unit-Tests
2. `npm run build:app` mit `VITE_APP_VERSION`, `VITE_APP_BUILD` (= Run-Nummer), `VITE_UPDATE_URL`
3. `dist/` → `web.zip` + SHA-256
4. `npx cap sync android`, APK bauen und signieren (Secrets `ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`)
5. Release `build-<n>` mit `Momentum.apk`, `web.zip`, `latest.json` (als „latest“), alte Releases
   bis auf 10 löschen

`latest.json`:

```json
{ "version": "1.2.7", "build": 7, "native": 1, "minNative": 1,
  "web": ".../build-7/web.zip", "apk": ".../build-7/Momentum.apk", "sha256": "…", "notes": "Commit-Text" }
```

## Wie die App sich aktualisiert

- Beim Start meldet das Bundle `notifyAppReady()`. Startet ein neues Bundle nicht innerhalb von
  15 s, rollt der Updater automatisch auf das vorherige zurück.
- 4 s nach dem Start und bei jedem Zurückkehren (höchstens alle 30 min) lädt die App
  `releases/latest/download/latest.json`.
- `build` neuer als das laufende Bundle und `minNative` ≤ installierte native Stufe → `web.zip`
  herunterladen (Prüfsumme Pflicht) → `next()`: aktiv, sobald die App in den Hintergrund geht oder
  neu startet. In den Einstellungen gibt es zusätzlich „Jetzt neu starten“.
- `native` höher als die installierte Stufe → Hinweis „Neue App-Version – APK herunterladen“
  (öffnet die APK im Browser, Android installiert sie über die vorhandene App, Daten bleiben).
- versionCode der APK = `native × 100000 + build`; daraus liest die App ihre native Stufe.

**Wann `momentum.native` erhöhen?** Immer wenn sich etwas Natives ändert: neues/aktualisiertes
Capacitor-Plugin, `android/`-Dateien, Berechtigungen, Icons, `capacitor.config.ts`. Erhöht man auch
`minNative`, bekommen alte Apps das neue Web-Bundle nicht mehr (nötig, wenn der Web-Code das neue
Plugin benutzt).

## Signatur

Der Schlüssel liegt nur auf Paddys PC (`signing/`, per `.gitignore` ausgeschlossen) und als GitHub-
Secret. Android akzeptiert Updates nur mit demselben Schlüssel – unbedingt sichern.

## Benachrichtigungen

- Plan aus `src/domain/notifications.ts` (gleiche Texte wie Web-Push), 7 Tage, höchstens 150 Stück.
- Neu geplant bei Datenänderung (2,5 s entprellt), beim Zurückkehren in die App und alle 30 min.
- `USE_EXACT_ALARM` im Manifest → pünktlich ohne Rückfrage; fehlt die Erlaubnis doch, wird
  ungenau geplant (keine Einstellungs-Seite beim automatischen Planen) und die Einstellungen zeigen
  „Erlauben“.
- „Erledigt ✓“ öffnet `#/today?done=<activityId_datum>`; die Heute-Seite hakt den Termin ab.

## Lokal bauen (optional, Android Studio)

```bat
npm ci
npm run android:sync
npx cap open android
```

## Grenzen

- Sync läuft nur, solange die App offen ist (Android pausiert Hintergrund-Apps). Änderungen
  anderer Geräte kommen beim nächsten Öffnen.
- Gebaut wird nur auf GitHub (die Cloud-Sitzung hat keinen Zugriff auf Googles Maven). Erster
  Build `build-1` am 04.11.2026 erfolgreich: APK mit dem eigenen Schlüssel signiert, Update-URL und
  Version eingebaut, `web.zip`-Prüfsumme stimmt mit `latest.json` überein.
- Auf einem echten Handy noch nicht getestet (kein Emulator in der Sitzung).
