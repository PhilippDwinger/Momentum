# Momentum – architecture

## Stack

| Concern      | Choice                                        | Why                                          |
|--------------|-----------------------------------------------|----------------------------------------------|
| UI           | React 19 + TypeScript, Vite 8                 | mainstream, fast, type-safe                  |
| Styling      | hand-written CSS with design tokens (`src/styles`) | full control, light/dark via `data-theme` |
| Storage      | IndexedDB via Dexie 4 (+ `dexie-react-hooks` live queries) | reliable local persistence, reactive |
| Icons        | lucide-react (tree-shaken)                    | consistent line icons                        |
| Validation   | zod (lazy-loaded, import only)                | robust backup validation                     |
| PWA          | vite-plugin-pwa / Workbox (`generateSW`)      | manifest, precache, offline                  |
| Fonts        | Manrope + Fraunces (self-hosted via fontsource) | works offline                              |
| Tests        | Vitest (+ fake-indexeddb), Playwright         | unit + real-browser E2E                      |

No account, no cloud service. Optional: the small **Momentum-Host** (`host/server.mjs`, Node) on
Paddy's PC serves the app, forwards `/bridge/*` to his Bridge server and sends Web Push.

## Layers

```
src/
  domain/     pure business logic – no React, no storage (fully unit-tested)
    dates.ts         local calendar-date arithmetic (DateKey 'YYYY-MM-DD')
    recurrence.ts    rule evaluation, schedule segments
    occurrences.ts   DataIndex + occurrence generation (moves, skips, unplanned progress)
    streaks.ts       per-activity streaks incl. protection
    stats.ts         day summaries, rates, buckets, heatmap levels
    gamification.ts  XP, levels, challenges, achievements (all derived)
    review.ts        deterministic weekly review
    scheduling.ts    overload detection + move suggestion
    motivation.ts, templates.ts
  data/       persistence
    db.ts            Dexie schema
    repository.ts    LocalRepository – the only writer (metadata, tombstones, outbox)
    actions.ts       intention-revealing mutations used by the UI
    exportImport.ts  JSON/CSV export, import apply; importParse.ts = validation (zod)
  sync/       synchronisation (see BRIDGE_SYNC.md)
    clock.ts         UUIDv7 + hybrid logical clock
    merge.ts         LWW merge of imported records
    bridge/          device-to-device sync over Bridge (engine, api, crypto, instance)
    SyncService.ts + BridgeSyncAdapter.ts  unused central-store alternative
  state/      React glue: AppData (live data + derived insights), prefs, router, toasts, overlays
  components/ reusable UI (checklist, sheets, editor, charts, icons)
  pages/      Today, Calendar, Activities, ActivityDetail, Stats, Review, Achievements, Settings, More
  hooks/      media queries, swipe, hotkeys, PWA, reminders
  i18n/       de (default) + en dictionaries, Intl formatting, rule descriptions
host/server.mjs   Momentum-Host: static app, /bridge proxy, Web Push scheduler
public/push-sw.js push + notification-click handler (imported into the Workbox SW)
```

Data flow: `useLiveQuery` loads all tables → `buildIndex()` → memoised derived data
(`history`, `game` with streaks/XP/achievements) in `AppDataProvider`. Pages compute what they
need from the index with domain functions. Writes go `actions → LocalRepository → IndexedDB`, and
the live query re-renders. Data volume of a personal tracker (thousands of entries) makes this
in-memory approach fast and simple.

## Data model

- **Activity**: name, description, icon (`i:<lucide>` or emoji), color, category, kind
  (`check | duration | count | custom`), unit, start/end date, `schedule: ScheduleSegment[]`,
  time, planned duration, reminder time, `partialCounts`, notes, `archivedAt`, `pauses[]`.
- **ScheduleSegment** `{from, anchor?, rule, target}` – a segment applies from `from` until the
  next one. "This and future" appends a segment; "entire series" replaces all; plain metadata
  edits keep the schedule untouched.
- **RecurrenceRule** `{freq: once|daily|weekly|monthly, interval, weekdays?, monthlyMode?,
  monthDay?, nth?, nthWeekday?}` – covers every day, weekdays, specific weekdays, weekly,
  every 2 weeks, monthly (day or nth/last weekday), every X days and custom intervals.
- **Entry** – progress for one occurrence (value, target snapshot, note). Deterministic id.
- **OccurrenceOverride** – exception for one occurrence (skip, move, target, time). Deterministic id.
- **Challenge**, **Category**, **UserSettings** – see `src/domain/types.ts`.

Occurrences are **never stored**; they are evaluated per date range. A recurring activity is
one record no matter how long it runs.

### Dates & time zones

A `DateKey` is a local calendar day and never converted to UTC. Arithmetic uses a UTC serial
day count purely for counting, which makes it immune to DST. "Today" is the local date with an
optional day boundary (`dayStartHour`, e.g. 03:00 for night owls) evaluated on wall-clock hours.
The time zone is a setting (`settings.timeZone`, '' = device zone). `zonedParts` reads wall-clock
time in that zone via `Intl`; `zonedTimeToUtc` turns "date + time in zone" into an instant for
push plans (two-pass offset correction, DST-safe).

## Rules worth knowing

**Status of an occurrence:** done (≥ target) · partial · missed (past, nothing) · pending (today)
· upcoming (future, cannot be logged) · skipped (neutral) · unplanned (progress on a date that is
no longer part of the schedule – kept visible, never counted as planned).

**Streaks** count consecutive *scheduled* occurrences, not calendar days. Rest days do not
exist for the streak, skipped occurrences are neutral, today's open item never breaks it, future
items never count. Optional protection forgives one miss per 7 days per activity while a streak
runs and only after a success since the previous forgiven miss. Forgiven dates are shown.

**Statistics:** rate = done ÷ evaluated; past days are final, today only counts what is done,
days without a plan are excluded. The heatmap gives partial credit and distinguishes "nothing
planned" from "nothing done".

**Gamification:** 10 XP per planned occurrence (proportional for partial, capped at target),
+20 XP for a fully completed day, challenge rewards. Level n needs `100·(n−1) + 25·(n−1)(n−2)`
XP. Everything is derived – undo removes XP, sync yields identical levels on every device.

**Archive** stops occurrences from the archive date on (by effective date); unarchiving records
the gap as a pause so it is not counted as missed.

## Notifications

`domain/notifications.ts` builds a 3-day plan (per-activity reminders, morning kick-off, evening
rescue) with texts that know the streak, the next milestone, yesterday's misses and the XP to the
next level. Devices upload the plan to the Momentum-Host (`/momentum-host/push/plan`); the host
sends Web Push at the right time. `public/push-sw.js` shows the notification and handles the
"Erledigt ✓" action (`#/today?done=<occurrence key>`).

## PWA

`vite.config.ts` configures the manifest (standalone, maskable icons, shortcuts) and a
Workbox service worker that precaches the app shell only. User data stays in IndexedDB and is
never put into the HTTP cache. Updates are offered via a toast ("Aktualisieren").
Without push (no host, or not enabled) reminders use the Notification API while the app runs.

## Testing

- `tests/*.test.ts` (Vitest, node + fake-indexeddb): dates/DST, all recurrence variants,
  segments, moves/skips, streak rules incl. protection, stats definitions, XP/levels/
  achievements/challenges, weekly review, smart scheduling, repository metadata/outbox,
  two-device sync via an in-memory transport, resumable push, export/import validation,
  regression tests from the code review, time zones + notification texts/plan, and Bridge
  sync scenarios (`tests/bridge-sync.test.ts`, in-memory Bridge or a real one via `BRIDGE_TEST_URL`).
- `e2e/run-e2e.mjs` (Playwright against the production build): create/edit/complete/undo/
  archive/delete, persistence across reloads, future lock, measurable logging, edit scopes,
  move/skip, calendar views + drag & drop, stats/review/achievements with demo data, JSON/CSV
  export, invalid import, keyboard shortcuts, theme/language persistence, mobile layout without
  overflow, swipe, service worker + offline usage, notification "done" action, time zone
  setting, and two browsers syncing through the host and a real Bridge (needs `BRIDGE_TEST_URL`).
