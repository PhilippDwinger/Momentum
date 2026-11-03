# CLAUDE.md – Momentum handover

Personal habit & motivation planner. Local-first PWA (React 19 + TS + Vite 8 + Dexie/IndexedDB).
Owner: Paddy. UI default language German (de), English available. Reply to Paddy in German.

## Commands

```bash
npm run dev          # http://localhost:5173
npm run build        # tsc -b && vite build (dist/, service worker)
npm run preview      # serve dist on :4173
npm test             # vitest (tests/*.test.ts)
npm run typecheck && npm run lint
npm run build && npm run test:e2e   # Playwright E2E (e2e/run-e2e.mjs), needs chromium
npx tsx e2e/make-demo.ts 2026-11-03 # regenerate demo fixture for a given "today"
```

All of these passed at handover (58 unit tests, 9/9 E2E, lint + typecheck clean).

## Map

- `src/domain/` pure logic (dates, recurrence, occurrences, streaks, stats, gamification,
  review, scheduling). Keep it free of React/storage. Every rule change needs a unit test.
- `src/data/repository.ts` is the ONLY writer: stamps HLC `version`, tombstones, outbox.
  UI calls `src/data/actions.ts`, never Dexie directly.
- `src/sync/` sync contract, LWW merge, `SyncService`, `BridgeSyncAdapter` placeholder.
- `src/state/AppData.tsx` live data + derived `history`/`game`. `uiContext` + `components/Overlays.tsx`
  host all dialogs (`ui.open({type:'editor' | 'occurrence' | 'log' | 'move' | …})`).
- `src/i18n/de.ts` is the source dictionary; `en.ts` is type-checked against it (add keys to both).
- Styles: `src/styles/base.css` (tokens, shell, primitives) + `pages.css`. Colors via CSS vars,
  activity color via `--ac` (`acStyle(color)`). Dark theme = `:root[data-theme='dark']`.

## Invariants (don't break)

- `DateKey` = local `YYYY-MM-DD`; never convert calendar days to UTC timestamps.
- Occurrences are derived, never stored. Identity = `activityId + originalDate`.
- Entry/override ids are deterministic (`e_…`, `o_…`) – needed for sync convergence.
- Schedule edits: `keep` (metadata only) / `from` (new segment, history untouched) / `all`.
  Segments with same freq+interval inherit `anchor` so biweekly/every-n rhythms don't shift.
- Entries store a target snapshot; it wins over the current plan for logged occurrences.
- Archive cutoff applies to the *effective* (moved) date. Unarchive adds a pause for the gap.
- XP/achievements/streaks are derived from data – never persist counters.
- Seeded built-in categories use `SEED_VERSION` (lowest) and no outbox entry.
- Future occurrences cannot be logged (`FutureLogError`).
- Buttons inside `<form>` need `type="button"` (bug fixed once in LogSheet).

## Status / next steps

- Bridge sync: implement `src/sync/BridgeSyncAdapter.ts` and wire `SyncService` in `src/main.tsx`
  – full guide in `docs/BRIDGE_SYNC.md`.
- Ideas not built: built-in timer for duration activities, push reminders (needs server),
  reordering activities by drag, field-level merge for activities.
