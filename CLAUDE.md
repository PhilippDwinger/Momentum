# CLAUDE.md – Momentum handover

Personal habit & motivation planner. Local-first (React 19 + TS + Vite 8 + Dexie/IndexedDB).
Phone = Android app (Capacitor 8, `android/`, auto-update from GitHub Releases); PC = browser via Momentum-Host.
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
npm start                           # build + Momentum-Host on :5180 (static + /bridge proxy + push)
npm run build:app && npx cap sync android   # web bundle for the Android app (no SW)
BRIDGE_TEST_URL=http://127.0.0.1:8002 npm test   # sync tests against a real Bridge
```

All of these passed at handover v1.2 (80 unit tests incl. 10 sync scenarios on an in-memory Bridge,
8 of them also against a real Bridge 3 server copy; 11/11 E2E incl. two-browser sync via host +
real Bridge; lint + typecheck clean). The test Bridge copy dies when a cloud turn ends – restart it
(`/home/claude/bridge-local`, PORT=8002) before real-Bridge runs, or E2E sync fails with 502. Note: Bridge allows 30 registrations/hour per address –
repeated real-Bridge test runs can hit `TOO_MANY_ATTEMPTS`; restart the test Bridge.

## Map

- `src/domain/` pure logic (dates, recurrence, occurrences, streaks, stats, gamification,
  review, scheduling). Keep it free of React/storage. Every rule change needs a unit test.
- `src/data/repository.ts` is the ONLY writer: stamps HLC `version`, tombstones, outbox.
  UI calls `src/data/actions.ts`, never Dexie directly.
- `src/sync/bridge/` device-to-device sync over Bridge (engine, api, crypto, instance). Bridge is
  pull-only + RAM-only; devices find each other via a hashed topic in the public realm and
  exchange encrypted direct messages. NEVER change Bridge (Paddy's rule) – only use its client API.
- `host/server.mjs` Momentum-Host: serves dist, proxies `/bridge/*` (Bridge has no CORS), Web Push
  (VAPID keys + plans in `host/data/push-state.json`, scheduler every 15 s).
- `src/domain/notifications.ts` motivational texts (de/en × gentle/motivating/intense) + push plan.
- `src/sync/SyncService.ts`/`BridgeSyncAdapter.ts` = unused central-store alternative.
- `src/platform/` Android layer: `native.ts` (IS_NATIVE, nativeFetch via CapacitorHttp – Bridge has
  no CORS), `localNotify.ts` (local notification plan, 7 days), `updater.ts` + `updateLogic.ts`
  (capgo updater, self-hosted on GitHub Releases), `shell.ts` (back button, system bars).
  Docs: `docs/ANDROID.md`. CI: `.github/workflows/android.yml` (every push → release build-<n>).
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
- Sync content comparison ignores createdAt/updatedAt/version/loggedAt (otherwise identical
  progress on two devices becomes a fake conflict).
- Only the device that joined the group later shows the initial choice dialog (`joinedAt`).
- Push group = sync `groupId`, or `'d'+deviceId` without sync. Plans are built on the device.
- Native changes (plugins, android/, permissions, capacitor.config) → bump `momentum.native` in
  package.json (and `minNative` if the web code needs it). APK versionCode = native*100000 + run no.
- Never commit `signing/` (release keystore; also stored as GitHub secrets).
- Capgo `download()` REQUIRES a sha256 checksum (CI writes it to latest.json).

## Status / next steps

- v1.1 (04.11.2026): timezone setting, sync over Bridge (Sync-ID groups, initial choice
  merge/theirs/mine, conflicts), Momentum-Host, Web Push with motivational texts.
- v1.2 (04.11.2026): Android app (APK) talking to Bridge directly, local notifications, auto-update
  via GitHub Releases (repo `Momentum`, public). Paddy wants the phone app as a downloaded file,
  not a website via Tailscale.
- Publishing from a cloud session: the cloud proxy blocks GitHub auth/repo creation; use the linked
  PC's device shell (gh in ~/tools, device-code login by Paddy) or Paddy's `Momentum-veroeffentlichen.bat`.
- APK cannot be built in the cloud sandbox (Google Maven blocked) – CI is the build; check
  Actions after every push. build-1 (04.11.2026) green; APK signature + baked update URL verified.
  Not yet tested on a real phone.
- Delivery flow used: commit in cloud → Momentum.zip (incl. .git + signing/) → extract into
  C:\Users\phili\Documents\Momentum via device shell → `git push` there with gh credential helper
  (deletion permission needed for git lock files).
- Ideas not built: built-in timer for duration activities, reordering activities by drag,
  field-level merge for activities.
