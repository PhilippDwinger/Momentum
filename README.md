# Momentum

Persönlicher Planer für Gewohnheiten, Routinen und Ziele – Kalender, Tages-Checkliste, Serien,
Statistiken und ein dezentes Belohnungssystem. Local-first: alle Daten bleiben auf dem Gerät,
die App funktioniert offline und lässt sich als PWA auf Handy und Desktop installieren.
Geräte mit derselben **Sync-ID** synchronisieren sich über deinen **Bridge**-Server
(Ende-zu-Ende verschlüsselt, Bridge wird nicht verändert), und Push-Benachrichtigungen mit
richtig motivierenden Texten kommen auch bei geschlossener App aufs Handy.

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
- **Sync über Bridge**: Sync-ID festlegen, alle Geräte mit derselben ID gleichen sich ab. Beim
  ersten Kontakt mit Daten auf beiden Seiten wählst du: zusammenführen, Daten der Gruppe oder
  Daten dieses Geräts. Gleichzeitige Änderungen werden als Konflikt angezeigt (oder automatisch
  „neuere gewinnt“). Details: [`docs/BRIDGE_SYNC.md`](docs/BRIDGE_SYNC.md).
- **Push-Benachrichtigungen**: Erinnerung pro Aktivität, Morgen-Kick, Abend-Rettung – mit
  Texten, die deine Serie, Meilensteine, Comebacks und Level kennen. Tonlage „Sanft“,
  „Motivierend“ oder „Krass 🔥“. Aktion „Erledigt ✓“ direkt in der Benachrichtigung.
- **Zeitzone** einstellbar (oder automatisch pro Gerät).
- Hell/Dunkel/System, Deutsch/Englisch, Tastenkürzel (`N`, `T`, `←/→`, `1–7`, `/`, `?`).

## Schnellstart (Windows, auf dem PC „muttchen“)

Voraussetzung: [Node.js](https://nodejs.org) 22 LTS (mindestens 20.19).

Doppelklick auf **`Momentum-Host-starten.bat`** (im Momentum-Ordner) – oder in CMD:

```bat
cd /d C:\Users\phili\Documents\Momentum
npm install
npm start
```

Das baut die App und startet den **Momentum-Host** auf `http://localhost:5180`. Der Host

1. liefert die App aus (auch offline-fähig als PWA),
2. reicht `/bridge/*` 1:1 an Bridge weiter (`https://muttchen.tail91b057.ts.net:8443`) –
   nötig, weil Bridge keine CORS-Header sendet; an Bridge selbst ändert das nichts,
3. verschickt die Push-Benachrichtigungen.

Das Fenster muss offen bleiben, solange Sync und Push laufen sollen (Autostart: Verknüpfung zur
`.bat` in `shell:startup` legen). Andere Bridge-Adresse: `set BRIDGE_URL=https://…` vor `npm start`.

Nur entwickeln ohne Host: `npm run dev` (Vite leitet `/bridge` ebenfalls an Bridge weiter).

## Momentum aufs Handy (App + Benachrichtigungen)

Push und Installation brauchen **HTTPS**. Am einfachsten über Tailscale, das du für Bridge schon
nutzt. Einmalig in CMD auf dem PC (Host läuft):

```bat
tailscale serve --bg --https=10000 http://127.0.0.1:5180
```

Damit ist Momentum im Tailnet unter **https://muttchen.tail91b057.ts.net:10000** erreichbar
(Handy mit aktiver Tailscale-App). Ohne Tailscale auf dem Handy stattdessen öffentlich:
`tailscale funnel --bg --https=10000 http://127.0.0.1:5180`.

Auf dem Handy (Android, Chrome):

1. `https://muttchen.tail91b057.ts.net:10000` öffnen → Menü → **„App installieren“**.
2. In der App: *Mehr → Einstellungen → Push-Benachrichtigungen → Push aktivieren* → erlauben.
   Es kommt sofort eine Test-Nachricht.
3. *Synchronisation über Bridge*: auf dem PC eine Sync-ID festlegen (oder „Generieren“), auf dem
   Handy **dieselbe ID** eintragen → „Synchronisation starten“. Haben beide schon Daten, fragt das
   Handy, wie zusammengeführt werden soll.
4. Erinnerungen pro Aktivität: Aktivität bearbeiten → „Erinnerung“ + Uhrzeit. Morgen-Kick,
   Abend-Rettung und Tonlage in den Push-Einstellungen.

iPhone: Push geht nur, wenn Momentum über Safari → Teilen → „Zum Home-Bildschirm“ installiert ist
(iOS 16.4+).

Hinweis: Jeder Ursprung (Adresse + Port) hat seinen eigenen Speicher. `localhost:5180` und
`…ts.net:10000` sind für den Browser zwei verschiedene Apps – genau dafür gibt es den Sync.

## Tests & Qualität

```bash
npm test             # Unit-Tests (Vitest) – Wiederholung, Serien, Statistik, Sync, Import …
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run build && npm run test:e2e   # Browser-E2E gegen den Produktions-Build (über den Host)

# mit einem echten Bridge-Server (z. B. lokal auf Port 8002):
set BRIDGE_TEST_URL=http://127.0.0.1:8002
npm test && npm run test:e2e
```

Für die E2E-Tests einmalig den Browser installieren: `npx playwright install chromium`.
`npx tsx e2e/make-demo.ts 2026-11-03` erzeugt den Demo-Datensatz
(`e2e/fixtures/demo-backup.json`), den du auch selbst importieren kannst, um die App mit
Beispieldaten anzusehen.

## Daten & Datenschutz

- Gespeichert wird in IndexedDB im Browser – ohne Konto, ohne Cloud, ohne Tracking.
- Sync: Bridge und der Momentum-Host sehen nur verschlüsselte Nachrichten (Schlüssel = Sync-ID).
- Push: Der Host speichert die geplanten Benachrichtigungen der nächsten 3 Tage
  (Titel + Text) in `host/data/push-state.json` auf deinem PC.
- Der Service Worker cached ausschließlich die App-Dateien, keine Nutzerdaten.
- Backups: *Einstellungen → Daten → Backup exportieren*. Auch mit Sync empfohlen – Sync ist
  kein Backup (ein Löschen wird überall übernommen).

## Bekannte Einschränkungen

- **Sync und Push brauchen den Momentum-Host** auf dem PC (und Bridge). Ist der PC aus, werden
  Änderungen gesammelt und später zugestellt (bis 7 Tage); Push-Nachrichten in dieser Zeit fallen aus.
- Push-Texte werden auf den Geräten erzeugt und beim Host hinterlegt (nächste 3 Tage). Erledigst
  du etwas, aktualisiert jedes Gerät der Gruppe den Plan – die Abend-Rettung entfällt dann.
- Ohne Host (z. B. reiner Entwicklungsserver) gibt es nur lokale Erinnerungen, solange die App offen ist.
- **Safari/iOS** kann Website-Daten nicht installierter Seiten nach längerer Nichtnutzung
  löschen. Als App installieren bzw. Backups exportieren. Die App fragt bei installierter
  Nutzung automatisch nach dauerhaftem Speicher.
- Zeitzone: Termine sind Kalendertage in der eingestellten Zeitzone (Standard: die des Geräts).
  Wer allen Geräten dieselbe Zeitzone geben will, stellt sie fest ein – die Einstellung wird mit
  synchronisiert.

## Dokumentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) – Aufbau, Datenmodell, Regeln (Serien, Statistik, XP)
- [`docs/BRIDGE_SYNC.md`](docs/BRIDGE_SYNC.md) – wie der Sync über Bridge funktioniert (Protokoll, Verschlüsselung, Konflikte)
- [`CLAUDE.md`](CLAUDE.md) – Übergabe-Notizen für künftige Entwicklungs-Sessions
