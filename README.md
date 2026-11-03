# Momentum

Persönlicher Planer für Gewohnheiten, Routinen und Ziele – Kalender, Tages-Checkliste, Serien,
Statistiken und ein dezentes Belohnungssystem. Local-first: alle Daten bleiben auf dem Gerät,
die App funktioniert offline und lässt sich als PWA auf Handy und Desktop installieren.
Die Synchronisation zwischen Geräten über **Bridge** ist architektonisch vorbereitet, aber
noch **nicht verbunden** (siehe [`docs/BRIDGE_SYNC.md`](docs/BRIDGE_SYNC.md)).

## Funktionen

- **Heute**: Begrüßung, Wochenleiste mit Fortschrittsringen, Tagesfortschritt, Checkliste nach
  Tageszeit, Serien, Wochen-Challenges, Motivationshinweis, Hinweis bei überladenen Tagen inkl.
  Verschiebe-Vorschlag (nur auf Klick). Vor/zurück per Pfeiltasten oder Wischen.
- **Aktivitäten**: Abhaken, Dauer (Minuten), Anzahl (mit Einheit) oder Messwert (Dezimal, eigene
  Einheit); Symbol/Emoji, Farbe, Kategorie, Uhrzeit, geplante Dauer, Erinnerung, Notizen,
  Start/Ende, Pausen, Archivieren, Duplizieren, Löschen (mit Rückgängig).
- **Wiederholung**: einmalig, täglich, werktags, bestimmte Wochentage, alle 2 Wochen, monatlich
  (Tag oder n-ter/letzter Wochentag), alle X Tage, eigene Regeln, optionales Ende.
  Bearbeiten wahlweise *nur dieser Termin*, *dieser und folgende* oder *gesamte Serie* –
  Vergangenheit und Statistik bleiben dabei erhalten.
- **Kalender**: Monat, Woche, Tag; Termine per Drag & Drop verschieben, direkt aus dem Kalender
  anlegen, Tagesdetails mit Checkliste.
- **Serien** pro Aktivität, die den Plan respektieren (Ruhetage brechen nichts), optionaler,
  transparenter Streak-Schutz.
- **Statistik**: Erfüllungsquote, Erledigt gesamt, aktuelle/längste Serie, perfekte Tage,
  Jahres-Heatmap, Wochen- und Monatsverlauf, Wochentag-Muster, Kategorien, Tabelle pro Aktivität,
  Filter nach Zeitraum/Kategorie/Aktivität, CSV-Export.
- **Wochenrückblick** (deterministisch, ohne KI-Dienst): Was gut lief, am beständigsten,
  Verpasstes, Vergleich zur Vorwoche, Trends, Fokus-Vorschlag.
- **Erfolge**: XP, Level, 15 Abzeichen, persönliche Wochen-Challenges – belohnt Beständigkeit,
  nicht Übertreibung.
- **Vorlagen** (Morgen-/Abendroutine, Lerneinheit, Training, Sprache, Programmieren …),
  Suche & Filter, Kategorien verwalten.
- **Daten**: JSON-Backup exportieren/importieren (Zusammenführen oder Ersetzen, mit Validierung),
  Verlauf als CSV.
- Hell/Dunkel/System, Deutsch/Englisch, Tastenkürzel (`N`, `T`, `←/→`, `1–7`, `/`, `?`).

## Schnellstart

Voraussetzung: [Node.js](https://nodejs.org) 22 LTS (mindestens 20.19).

```bash
npm install
npm run dev        # Entwicklungsserver: http://localhost:5173
```

Produktions-Build (mit Service Worker / Offline-Modus):

```bash
npm run build
npm run preview    # http://localhost:4173
# oder beides in einem Schritt:
npm start
```

Der Inhalt von `dist/` ist eine rein statische Website und kann auf jedem Webserver bzw.
Static-Hosting liegen (relative Pfade, Hash-Routing – keine Server-Konfiguration nötig).

## Auf dem Handy nutzen und installieren

Service Worker und Installation funktionieren nur über **HTTPS** oder `localhost`.

- **Schnell testen im WLAN:** `npm run dev -- --host` und die angezeigte Netzwerk-Adresse
  (`http://192.168.…:5173`) am Handy öffnen. Die App läuft, aber ohne Offline-Modus und
  Installation (kein sicherer Kontext).
- **Richtig installieren:** `dist/` auf einen HTTPS-Host legen (eigener Server, NAS mit
  Zertifikat, oder ein beliebiger Static-Host). Dann im Browser öffnen und
  - Android/Chrome: Menü → „App installieren“ bzw. Button in *Einstellungen → App*,
  - iPhone/Safari: Teilen → „Zum Home-Bildschirm“,
  - Desktop Chrome/Edge: Installations-Symbol in der Adressleiste.

Hinweis: Jeder Ursprung (Domain/Port) hat seinen eigenen Speicher. Daten von `localhost` sind
nicht automatisch auf der installierten Version – nutze Export/Import oder später Bridge.

## Tests & Qualität

```bash
npm test             # Unit-Tests (Vitest) – Wiederholung, Serien, Statistik, Sync, Import …
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run build && npm run test:e2e   # Browser-E2E gegen den Produktions-Build
```

Für die E2E-Tests einmalig den Browser installieren: `npx playwright install chromium`.
`npx tsx e2e/make-demo.ts 2026-11-03` erzeugt den Demo-Datensatz
(`e2e/fixtures/demo-backup.json`), den du auch selbst importieren kannst, um die App mit
Beispieldaten anzusehen.

## Daten & Datenschutz

- Gespeichert wird in IndexedDB im Browser – ohne Konto, ohne Server, ohne Tracking.
- Der Service Worker cached ausschließlich die App-Dateien, keine Nutzerdaten.
- Backups: *Einstellungen → Daten → Backup exportieren*. Regelmäßig empfohlen, solange keine
  Synchronisation aktiv ist.

## Bekannte Einschränkungen

- **Synchronisation:** vorbereitet, aber nicht verbunden. Es werden keine Daten zwischen Geräten
  übertragen. Details und genaue Einbaustelle: [`docs/BRIDGE_SYNC.md`](docs/BRIDGE_SYNC.md).
- **Erinnerungen** erscheinen nur, solange Momentum geöffnet ist oder im Hintergrund läuft.
  Echte Push-Nachrichten bei geschlossener App bräuchten einen Server (z. B. künftig über Bridge).
- **Safari/iOS** kann Website-Daten nicht installierter Seiten nach längerer Nichtnutzung
  löschen. Als App installieren bzw. Backups exportieren. Die App fragt bei installierter
  Nutzung automatisch nach dauerhaftem Speicher.
- Zeitzone: Termine sind lokale Kalendertage. Wer reist, sieht seine Termine am jeweiligen
  lokalen Kalendertag.

## Dokumentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) – Aufbau, Datenmodell, Regeln (Serien, Statistik, XP)
- [`docs/BRIDGE_SYNC.md`](docs/BRIDGE_SYNC.md) – Synchronisationskonzept und Einbau des Bridge-Adapters
- [`CLAUDE.md`](CLAUDE.md) – Übergabe-Notizen für künftige Entwicklungs-Sessions
