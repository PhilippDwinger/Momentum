# Momentum

Persönlicher Planer für Gewohnheiten, Routinen und Ziele – Kalender, Tages-Checkliste, Serien,
Statistiken und ein dezentes Belohnungssystem. Local-first: alle Daten bleiben auf dem Gerät,
die App funktioniert offline. Auf dem Handy als **Android-App (APK) mit Auto-Update**, am PC im
Browser.
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
- **Sync über Bridge**: Sync-ID festlegen, alle Geräte mit derselben ID gleichen sich ab – auch im
  Browser direkt mit Bridge (`https://muttchen.tail91b057.ts.net:8443/momentum/`). Beim
  ersten Kontakt mit Daten auf beiden Seiten wählst du: zusammenführen, Daten der Gruppe oder
  Daten dieses Geräts. Gleichzeitige Änderungen werden als Konflikt angezeigt (oder automatisch
  „neuere gewinnt“). Details: [`docs/BRIDGE_SYNC.md`](docs/BRIDGE_SYNC.md).
- **Push-Benachrichtigungen**: Erinnerung pro Aktivität, Morgen-Kick, Abend-Rettung – mit
  Texten, die deine Serie, Meilensteine, Comebacks und Level kennen. Tonlage „Sanft“,
  „Motivierend“ oder „Krass 🔥“. Aktion „Erledigt ✓“ direkt in der Benachrichtigung.
- **Zeitzone** einstellbar (oder automatisch pro Gerät).
- Hell/Dunkel/System, Deutsch/Englisch, Tastenkürzel (`N`, `T`, `←/→`, `1–7`, `/`, `?`).

## Schnellstart: Momentum im Browser (PC + Handy)

Momentum läuft unter der Adresse deines Bridge-Servers:

**https://muttchen.tail91b057.ts.net:8443/momentum/**

Weil die App unter derselben Adresse wie Bridge liegt, redet der Browser **direkt mit Bridge**
(von jeder anderen Adresse aus verbietet der Browser das, weil Bridge keine CORS-Freigabe sendet).
An Bridge selbst ändert sich nichts: Tailscale leitet nur den Pfad `/momentum` an den
Momentum-Host auf deinem PC weiter, alles andere geht wie bisher an Bridge.

Einmalig auf dem PC „muttchen“ (Voraussetzung: [Node.js](https://nodejs.org) 22 LTS):

1. Doppelklick auf `C:\Users\phili\Documents\Momentum\Momentum-Host-starten.bat`
   (Fenster offen lassen; Autostart: Verknüpfung zur `.bat` in `shell:startup` legen).
2. Der Host richtet die Tailscale-Weiterleitung `…:8443/momentum` selbst ein (gleiche
   Sichtbarkeit wie Bridge: öffentlich per Funnel) und prüft sie alle 5 Minuten. Von Hand ginge es so:
   ```bat
   tailscale funnel --bg --https=8443 --set-path=/momentum http://127.0.0.1:5180
   ```
3. Er lädt die neueste App-Version von GitHub (alle 5 Minuten neu geprüft).

Auf dem Handy (Chrome) und am PC: die Adresse oben öffnen → Menü → **„App installieren“**
(geht das nicht, „Zum Startbildschirm hinzufügen“). Dann *Einstellungen*:
Push aktivieren, Sync-ID eintragen → „Synchronisation starten“.

**Updates:** Nie neu installieren. Jeder Push ins GitHub-Repo baut eine neue Version, der Host
lädt sie, die App zeigt „Eine neue Version ist verfügbar – Aktualisieren“ (oder ist beim
nächsten Öffnen aktuell). Ganz unten in den Einstellungen steht zum Prüfen ein „Update-Test“-Satz
mit der Build-Nummer.

Was der Host macht: App-Dateien ausliefern + aktuell halten, Push-Nachrichten verschicken
(Web-Push braucht einen Absender, Bridge schickt nie von sich aus). Gesynct wird nur über Bridge.
Ist der Host aus, läuft die installierte App trotzdem (offline-fähig) und synct weiter direkt
über Bridge – nur Push-Nachrichten bleiben dann aus.

Entwickeln: `npm run dev` (Vite leitet `/bridge` an Bridge weiter).

## Alternativ: Android-App (APK)

Wenn auf dem Handy APK-Installationen erlaubt sind (eine Kindersicherung wie Family Link blockt
sie), gibt es Momentum auch als **echte Android-App**. Sie läuft ohne PC und ohne Tailscale:

- Sync: Die App redet **direkt mit deinem Bridge-Server** `https://muttchen.tail91b057.ts.net:8443`
  (über Androids eigenen HTTP-Stack, deshalb stört das fehlende CORS von Bridge nicht).
- Benachrichtigungen: Die App plant Erinnerungen, Morgen-Kick und Abend-Rettung **auf dem Handy
  selbst** (7 Tage im Voraus, mit „Erledigt ✓“-Knopf). Sie kommen auch bei geschlossener App.
- Updates: Jede Änderung im GitHub-Repo baut automatisch eine neue Version. Die App prüft beim
  Öffnen, lädt die neue Version im Hintergrund und ist beim nächsten Öffnen aktuell.

**Installieren**

1. Auf dem Handy in Chrome **https://github.com/PhilippDwinger/Momentum/releases/latest** öffnen →
   `Momentum.apk` antippen → herunterladen.
2. Datei öffnen → Android fragt einmal, ob Chrome Apps installieren darf → *Zulassen* → *Installieren*.
   (Play Protect kann warnen, weil die App nicht aus dem Play Store kommt → „Trotzdem installieren“.)
3. Momentum öffnen → *Mehr → Einstellungen*:
   - *Push-Benachrichtigungen → Push aktivieren* → erlauben. Es kommt sofort eine Test-Nachricht.
   - *Synchronisation über Bridge*: dieselbe **Sync-ID** wie auf dem PC eintragen → „Synchronisation
     starten“. Haben beide Seiten schon Daten, fragt das Handy, wie zusammengeführt wird.
4. Damit Erinnerungen pünktlich kommen: Akku-Optimierung für Momentum ausschalten
   (*Einstellungen → Apps → Momentum → Akku → Nicht eingeschränkt*), vor allem bei Samsung/Xiaomi.

**Updates**

- Normale Änderungen kommen **automatisch** (*Einstellungen → App & Updates* zeigt Version und Status).
- Nur wenn sich der native Teil der App ändert (`momentum.native` in `package.json` wird erhöht),
  zeigt die App „Neue App-Version – APK herunterladen“. Einmal installieren, die Daten bleiben.
- Neue Version veröffentlichen: Änderungen committen und `Momentum-veroeffentlichen.bat`
  (bzw. `git push`). GitHub baut dann `Momentum.apk`, `web.zip` und `latest.json` als Release.

**Einmalige GitHub-Einrichtung** (falls noch nicht geschehen): Doppelklick auf
`Momentum-GitHub-einrichten.bat`. Sie installiert bei Bedarf Git und GitHub CLI, meldet dich im
Browser an, legt das öffentliche Repo `Momentum` an, hinterlegt den Signatur-Schlüssel aus
`signing\` als Secret und lädt alles hoch. Details: [`docs/ANDROID.md`](docs/ANDROID.md).

**Wichtig:** Den Ordner `signing\` (Signatur-Schlüssel) sichern und nie hochladen. Ohne ihn kann
eine neue APK die installierte App nicht mehr aktualisieren.

iPhone: geht als APK nicht – dort die Browser-Version (oben) nehmen.

## Andere Adressen

`http://localhost:5180` (direkt am PC) funktioniert auch: Dort reicht der Host `/bridge/*` an
Bridge weiter. Jede Adresse hat aber ihren eigenen Speicher – am besten überall die Adresse oben
benutzen und zwischen Geräten per Sync-ID abgleichen.

## Tests & Qualität

```bash
npm test             # Unit-Tests (Vitest) – Wiederholung, Serien, Statistik, Sync, Import …
npm run typecheck    # TypeScript
npm run lint         # ESLint
npm run build && npm run test:e2e   # Browser-E2E gegen den Produktions-Build (über den Host)
node e2e/run-direct.mjs              # Browser direkt über Bridge unter /momentum/ + Host-Auto-Update (braucht BRIDGE_TEST_URL)

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
- Push im Browser: Der Host speichert die geplanten Benachrichtigungen der nächsten 3 Tage
  (Titel + Text) in `host/data/push-state.json` auf deinem PC. Die Android-App plant lokal.
- Das GitHub-Repo ist öffentlich (nötig, damit die App Updates ohne Passwort laden kann). Es
  enthält nur Code – keine Daten, keine Sync-ID, keinen Schlüssel. Die Bridge-Adresse steht
  im Code und in der App.
- Der Service Worker cached ausschließlich die App-Dateien, keine Nutzerdaten.
- Backups: *Einstellungen → Daten → Backup exportieren*. Auch mit Sync empfohlen – Sync ist
  kein Backup (ein Löschen wird überall übernommen).

## Bekannte Einschränkungen

- **Android-App:** braucht nur Bridge. Sync läuft, solange die App offen ist; Änderungen von
  anderen Geräten kommen beim nächsten Öffnen an (Bridge hält sie bis 7 Tage). Die geplanten
  Benachrichtigungen kennen den Stand vom letzten Öffnen – wer am PC etwas erledigt, bekommt die
  Abend-Rettung am Handy evtl. trotzdem, bis die App einmal geöffnet wurde.
- **Browser-App:** Sync braucht nur Bridge (direkt, unter `…:8443/momentum/`). Push-Nachrichten
  verschickt der Momentum-Host – ist der PC aus, kommen sie nicht (Bridge läuft ja auch auf dem PC).
  Der Push-Plan reicht 3 Tage im Voraus.
- **Safari/iOS** kann Website-Daten nicht installierter Seiten nach längerer Nichtnutzung
  löschen. Als App installieren bzw. Backups exportieren. Die App fragt bei installierter
  Nutzung automatisch nach dauerhaftem Speicher.
- Zeitzone: Termine sind Kalendertage in der eingestellten Zeitzone (Standard: die des Geräts).
  Wer allen Geräten dieselbe Zeitzone geben will, stellt sie fest ein – die Einstellung wird mit
  synchronisiert.

## Dokumentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) – Aufbau, Datenmodell, Regeln (Serien, Statistik, XP)
- [`docs/BRIDGE_SYNC.md`](docs/BRIDGE_SYNC.md) – wie der Sync über Bridge funktioniert (Protokoll, Verschlüsselung, Konflikte)
- [`docs/ANDROID.md`](docs/ANDROID.md) – Android-App: Build über GitHub Actions, Auto-Update, Signatur, Benachrichtigungen
- [`CLAUDE.md`](CLAUDE.md) – Übergabe-Notizen für künftige Entwicklungs-Sessions
