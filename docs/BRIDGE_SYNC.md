# Sync über Bridge – wie es funktioniert

Status: **implementiert und getestet** (gegen eine Kopie des echten Bridge-3-Servers, Stand
Teil 22). An Bridge selbst wurde **nichts** geändert – Momentum nutzt nur die vorhandene
Client-API. Bridge übernimmt keine Sync-Logik: es leitet Nachrichten weiter, die Geräte reden
miteinander.

```
 Handy (Android-App) ── direkt (native HTTP) ───────────────►  Bridge
                                                                (https://muttchen.tail91b057.ts.net:8443)
 PC (Browser) ── http://localhost:5180/bridge/* ── Momentum-Host ── 1:1 weiter ──►  Bridge
```

## Warum der Momentum-Host (nur im Browser) dazwischen sitzt

Die Android-App braucht ihn nicht: Sie ruft Bridge über Androids eigenen HTTP-Stack auf
(`CapacitorHttp`, `src/platform/native.ts`), dort gibt es kein CORS. Ändert man in der App den
Bridge-Server, registriert sich das Gerät dort neu (`load()` verwirft das alte Konto).

Bridge schickt keine CORS-Header. Ein Browser darf deshalb Antworten von Bridge nur lesen,
wenn die App vom **gleichen Ursprung** kommt. Der Host (`host/server.mjs`) liefert die App aus
und reicht `/bridge/*` unverändert an Bridge weiter (inkl. `X-Forwarded-For`). Er versteht den
Inhalt nicht – alles ist Ende-zu-Ende verschlüsselt. Zusätzlich verschickt er die
Push-Benachrichtigungen (siehe README).

## Gruppen: die Sync-ID

Alle Geräte mit derselben **Sync-ID** bilden eine Gruppe. Mehrere Personen können denselben
Bridge-Server nutzen – jede Gruppe ist getrennt:

| aus der Sync-ID abgeleitet | wofür |
|---|---|
| `topic = "momentum." + sha256("momentum\|group\|ID")[0:32]` | Topic im öffentlichen Realm, über das sich die Geräte finden |
| AES-GCM-256-Schlüssel (PBKDF2-SHA256, 120 000 Runden) | verschlüsselt jede Nachricht (vorher deflate-komprimiert) |
| `groupId = "g" + sha256(…)[32:56]` | Push-Gruppe beim Momentum-Host |

Bridge und andere Nutzer sehen nur den Hash und Chiffretext. Die ID ist das Geheimnis – lang und
zufällig ist am sichersten („Generieren“ in den Einstellungen).

## Bridge-Konto pro Gerät

Jedes Gerät registriert sich einmal (`/client/register`) mit zufälligem Passwort und einem
`identity_secret` → **stabile Client-IP**. Nach einem Bridge-Neustart ohne Backup meldet sich das
Gerät mit demselben Secret neu an und bekommt dieselbe IP. Sessions (60 min) werden automatisch
erneuert. Danach: `GET /realm/public`, `/realm/join`, `/realm/topic/subscribe`.

## Protokoll (alles verschlüsselt, Typ `t`)

| Nachricht | Weg | Inhalt |
|---|---|---|
| `hello` | Topic-Event (10 min) | Geräte-ID, Name, Beitrittszeit, Datenumfang – alle 10 min und nach jedem Login |
| `welcome` | Direktnachricht (1 Tag) | Antwort auf `hello`, inkl. Liste der bekannten Geräte |
| `changes` | Direktnachricht `temporary`, **7 Tage** | Datensätze ab dem Cursor des Empfängers (≤ 56 KB pro Nachricht) |
| `ack` | Direktnachricht (7 Tage) | „bis Seq X angekommen“ → Cursor rückt vor |
| `resync` | Direktnachricht | „schick mir ab Seq X nochmal“ (nach der Erstentscheidung) |

Gepollt wird per Long-Poll (`/message/poll`, `wait_seconds` 20, `max_messages` 50,
`content_types` event+direct).

**Was übertragen wird:** das kompakte Änderungsprotokoll (`changes`-Tabelle, ein Eintrag pro
Datensatz). Jedes Gerät schickt jedem anderen alles, was es kennt – auch Änderungen, die es von
Dritten bekommen hat (`origin: 'remote'`). Damit kommen Daten auch an, wenn nie alle Geräte
gleichzeitig online sind (Lebensdauer 7 Tage, danach erneutes Senden). Doppelte Zustellung ist
harmlos: gleiche Version = nichts passiert.

**Was lokal bleibt:** Theme, Sprache, Ansichten, Push-Abo (`localStorage`), Bridge-Konto,
Peer-Liste, Cursor, Konflikte (`meta`/`conflicts` in IndexedDB).

## Zusammenführen

- **Last-Writer-Wins** pro Datensatz über die HLC-Version (`<ms>:<counter>:<deviceId>`).
- **Gleicher Inhalt** (z. B. beide Geräte haken denselben Termin ab) → kein Konflikt.
- **Echter Konflikt:** dieses Gerät hat den Datensatz selbst geändert, der andere hat diese
  Änderung noch nicht bestätigt, und der andere schickt eine *eigene*, inhaltlich andere
  Änderung. Dann (Einstellung „Nachfragen“) landet er unter *Einstellungen → Synchronisation →
  Konflikte lösen*: „Meine behalten“, „Andere nehmen“ oder bei Einträgen „Kombinieren“ (höherer
  Wert, beide Notizen). Die Entscheidung bekommt eine neue Version und gewinnt überall.
  Alternative Einstellung: „Neuere Version gewinnt“ (automatisch).
- **Löschen** = Tombstone mit neuer Version – setzt sich durch und wird nie wiederbelebt.

## Erster Kontakt: beide Geräte haben schon Daten

Das Gerät, das der Gruppe **später** beigetreten ist, fragt:

| Auswahl | Wirkung |
|---|---|
| **Zusammenführen** (empfohlen) | beide Seiten behalten alles, gleiche Datensätze nach LWW |
| **Daten der Gruppe übernehmen** | lokale Daten werden (ohne Tombstones) geleert, dann kommt alles aus der Gruppe |
| **Daten dieses Geräts übernehmen** | alle eigenen Datensätze bekommen neue Versionen; was nur in der Gruppe existiert, wird dort gelöscht |

Bis zur Entscheidung tauscht das Gerät keine Daten aus. Hat eine Seite noch keine Daten, wird
ohne Nachfrage zusammengeführt.

## Code

| Datei | Inhalt |
|---|---|
| `src/sync/bridge/api.ts` | minimaler Bridge-3-Client (register, login, realm, topic, send, poll) |
| `src/sync/bridge/crypto.ts` | Schlüssel aus der Sync-ID, `seal`/`unseal`, ID-Generator |
| `src/sync/bridge/engine.ts` | `BridgeSync`: Sessions, Peers, Cursor, Senden/Empfangen, Erstentscheidung, Konflikte |
| `src/sync/bridge/instance.ts` | App-Instanz + React-Hook, Host-Infos |
| `src/components/SyncPanels.tsx` | Einstellungen, Auswahl-Dialog, Konflikt-Dialog |
| `host/server.mjs` | Auslieferung, `/bridge`-Weiterleitung, Push |
| `tests/bridge-sync.test.ts` | Szenarien (Erstabgleich, alle 3 Auswahlen, Konflikte, Löschen, getrennte IDs, Neustart) |

Tests gegen einen echten Bridge-Server: `BRIDGE_TEST_URL=http://127.0.0.1:8002 npm test` bzw.
`npm run build && BRIDGE_TEST_URL=… npm run test:e2e` (zwei Browser über den Host).

## Grenzen

- Daten kommen nur an, solange Bridge läuft (RAM). Bei einem Bridge-Neustart ohne Backup gehen
  wartende Nachrichten verloren – die Geräte schicken nach dem nächsten `hello` erneut.
- Ein Datensatz über 56 KB (sehr lange Notiz) kann nicht übertragen werden.
- Alle Geräte erscheinen für Bridge mit der Adresse des Hosts (Rate-Limits von Bridge zählen pro
  Adresse; für einige Geräte unkritisch). Mit `BRIDGE_TRUST_PROXY=1` in Bridge würde
  `X-Forwarded-For` ausgewertet.
- `src/sync/SyncService.ts` + `BridgeSyncAdapter.ts` gehören zum alternativen Modell mit einem
  zentralen Speicher und werden nicht benutzt.
