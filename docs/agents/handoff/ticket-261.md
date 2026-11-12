# Ticket #261 (refresh prompt for a newer release) — facts for later tickets

Branch `agent/issue-261-pwa-refresh-prompt-when-a-newer-release-is-deploye`. Files:
`apps/web/src/pwa/update.ts`, `apps/web/src/components/UpdatePrompt.tsx`, `apps/web/src/App.tsx`,
`apps/web/vite.config.ts`, `Caddyfile`, `apps/web/messages/{hu,en,de}.json`,
`apps/web/test/update.test.ts`, `apps/web/test/sw-routing.test.ts`. Spec #184, Decision 3.

## The check

- `apps/web/src/pwa/update.ts` exports `UPDATE_CHECK_INTERVAL_MS` (5 min), `UPDATE_CHECK_MIN_GAP_MS` (1 min),
  `releaseOf`, `deployedRelease`, `isStale`, `canReload`, `watchForUpdate`, and the types `VersionFetch`,
  `ScheduleCheck`, `ListenVisible`, `UpdateWatchOptions` and `StopUpdateWatch`.
- `deployedRelease(fetcher = fetch)` GETs `/version.json` with `{ cache: "no-store" }`; it answers the non-empty
  string in `{ "release": … }`, and returns `null` for a non-ok response, a network error, a non-JSON body or a
  malformed one. The checker never throws.
- `isStale(running, deployed)` is true only when both are non-`dev` strings and differ. `dev` is a local/dev
  build, not a release (Vite's `CLIENT_RELEASE` define is `env["RELEASE"] || "dev"`).
- `watchForUpdate` checks immediately, then on `UPDATE_CHECK_INTERVAL_MS` and on every
  `visibilitychange` back to `visible`, but never more often than `UPDATE_CHECK_MIN_GAP_MS` (the gap is read
  from `now`, default `Date.now`). The first update calls `onUpdate(deployed)` once and stops both the timer and
  the listener; the returned `StopUpdateWatch` also stops them (a fetch that lands after the stop never
  prompts). `release`, `schedule`, `listenVisible` and `now` are the injection seams the tests use.
- `canReload(pathname)` is the one reload gate: false for `/game/…` (a Game holds the Seat, Turn and open
  Decision), true everywhere else.

## The prompt

- `UpdatePrompt` (mounted in `App.tsx` inside `BrowserRouter`, after `Routes`) owns the watcher in one effect and
  the `deployed`/`dismissed` state. It renders nothing until a different release arrives or after **Later**.
- The wrapper is always mounted: `fixed inset-x-0 top-0 z-40`, `pointer-events-none` (taps reach the Board)
  and `aria-live="polite"` (a persistent live region, so the insert is announced). The `Card` appears inside it
  only on an update: `pointer-events-auto`, `data-testid="update-prompt"`. It is not a modal and sits below
  `ReconnectOverlay` and the shadcn `Dialog` (both `z-50`), so an open Decision keeps its tray.
- Outside `/game/…` it offers **Refresh** (`window.location.reload()`) and **Later**; inside a Game only
  **Later**, with `m.update_in_game()`, so a game is never reloaded under the Player. A new deployment reaches
  the waiting service worker on the next launch.
- Messages: `update_available`, `update_refresh`, `update_later`, `update_in_game` in all three languages.
  They pass `apps/web/test/messages.test.ts`.

## The deployment side

- `apps/web/vite.config.ts` has `releaseVersion(release)`, plugin name `universum:release-version`,
  `apply: "build"`. Its `generateBundle` emits `version.json` at the build root with
  `{"release":"<RELEASE>"}` (plus a newline), from the same `env["RELEASE"] || "dev"` as `CLIENT_RELEASE`.
  A built `dist/version.json` exists; the dev server serves no file, and its `dev` release is silent anyway.
- `Caddyfile` has `handle /version.json` before the source-map and SPA handles: `Content-Type:
  application/json`, `Cache-Control: no-cache`. The `@shell` matcher also excludes `/version.json`, so the SPA
  fallback and the shell's `no-cache` policy cannot answer it.
- The service worker leaves `/version.json` alone: `routeOf` answers `never` (it is neither `/assets/*` nor a
  navigation), pinned in `apps/web/test/sw-routing.test.ts`. The worker also never sends it a message; the
  comparison is entirely the page's.

## Gotchas

- Do not cache `/version.json`, and do not add it to `public/` or the shell cache: a cached copy misses the
  deploy the prompt exists for.
- Do not bypass `canReload` in the prompt. A reload in `/game/…` throws away the Player's game; the spec's
  Decision 3 forbids it.
- `CLIENT_RELEASE` is a Vite `define`; a new module that reads it needs its own
  `declare const CLIENT_RELEASE: string` (declarations are per-file, as in `error-reporting.ts` and `sw.ts`).
- The heuristics stay injectable: `watchForUpdate`'s tests pass a scripted `release`, a captured `schedule`,
  a captured `listenVisible` and a fake `now`; the default schedule is one `setTimeout`, the default visibility
  source is `document`, and the default clock is `Date.now`.
- The watcher stops after the first update; a dismissed prompt stays dismissed for that launch. Another deploy
  in the same launch is not announced until the page reloads — deliberate, one prompt per launch.
