# Ticket #44 (opt-in error reporting / engine failures) — extension points and gotchas

Branch `ticket/44-errors`. Builds on #25 (deadline), #34 (store), #37 (limiter), #43 (logs/metrics).

## Server: reporting is opt-in

- `config.sentryDsn` (`SENTRY_DSN`) is `string | null`; `loadConfig` validates it with
  `parseDsn` (`observability/dsn.ts`) and throws on anything that is not a Sentry-protocol DSN
  (`https://<public key>@<host>[/<path>]/<project id>`). `main.ts` parses it once and hands the
  `Dsn` to `createGameServer({ errorReporting: dsn })` and to the reporter.
- `ErrorReporter` (`observability/error-reporting.ts`) is the seam: `report(error, context)` +
  `flush(timeoutMs)`. `noReporter` is the default everywhere (tests, no DSN).
  `createSentryReporter` (`observability/sentry-reporter.ts`) starts `@sentry/node` with
  `release: config.release`, **`dataCollection` instead of `sendDefaultPii`** (Sentry 11 removed
  that option: `userInfo: false` is the equivalent), and filters the `ProcessSession`
  integration (no sessions). Tracing is off by not setting `tracesSampleRate`; replays are not
  installed.
- Engine throws feed `GameRoom.failed()`: log at `error` with `{roomCode, version, phase, intent}`
  (never `state`/`game`/`view`, which are pino-redacted), then `reporter.report(error, context)`.
  `#throwsInARow` counts engine throws only; the third is logged at `fatal`. Turn-deadline
  failures retry at 5 s doubling to 60 s (`DEADLINE_RETRY_MS` / `DEADLINE_RETRY_MAX_MS` in
  `room/game-room.ts`), so a broken deadline never stops the Room.
- `installCrashHandlers` (`observability/crash-handlers.ts`): `uncaughtException` /
  `unhandledRejection` → `fatal` log, flush with a 2 s cap, `exit(1)`. Sentry's own handlers
  capture the event but leave exiting to this module (they see another listener). Installed in
  `main.ts`; tests pass an `EventEmitter`.

## Browser-facing routes

- `observability/error-envelope.ts`: split/sanitize/join Sentry envelopes. Item payload lengths
  are **bytes**, not characters. `sanitizeEvent` strips whole keys named like
  `guestToken`/`token`/`reconnectionToken`/`password`/`ip_address`, and request
  headers/cookies/env, at every depth (arrays included).
- `http/browser-routes.ts` (`createBrowserRoutes({dsn, guard, log})`) serves:
  - `GET /client-config` → `{ errorReporting: boolean }` (always 200; 405 otherwise).
  - `POST /errors` → 404 when `dsn` is null; else 10/min per IP
    (`limits.errorEventsPerMinute`, `LIMIT_ERROR_EVENTS_PER_MINUTE`, metric
    `limiter_refusals_total{limit="error_events"}`), body cap `limits.errorReportBytes`
    (`LIMIT_ERROR_REPORT_BYTES`, 200 KB), only `event` items, rewritten `dsn` header, forwarded
    to `dsn.envelopeUrl`. Non-event-only envelopes are 200 and forward nothing; malformed is 400;
    tracker failure is 502.
- `createGatedHttpServer(guard, routes)` runs these **before** matchmaking in `gate()`, after
  setting `X-Real-IP`. New browser routes belong in `createBrowserRoutes` (or another handler with
  the same shape), not in Colyseus's router.
- `Caddyfile` has its own `handle` for each (`/client-config`, `/errors`); without one the SPA
  shell answers. `apps/web/vite.config.ts` proxies both to `PORT` in dev, so the same paths work
  locally.
- Caddy is stock: no body-size or rate limit config there; all limits stay in Node as in #37.

## Client

- `apps/web/src/error-reporting.ts` `startErrorReporting()` is awaited at the top of `main.tsx`
  (before the first render) and fetches `/client-config`. On `true` it calls
  `Sentry.init({ dsn: PLACEHOLDER_DSN, release: CLIENT_RELEASE, tunnel: "/errors", ... })`.
  The placeholder DSN (`https://public@errors.invalid/1`) is never contacted; the tunnel
  rewrites it.
- `CLIENT_RELEASE` is a Vite `define` from `RELEASE` (falls back to `dev`), the same SHA as the
  server. The Docker `web-build` stage takes `ARG RELEASE`; `compose.yaml` passes it to both
  targets (before #44 only the server got it).
- To disable sessions, the `integrations` function filters by name `"BrowserSession"`. Sentry's
  browser SDK has no `autoSessionTracking` option in v11.
- `apps/e2e/tests/error-reporting.spec.ts` intercepts `/client-config` and `/errors` with
  Playwright, throws in the page and asserts an `event` envelope (no `session` item) arrives.

## Tests

- `test/error-tunnel.test.ts`: a real `node:http` fake tracker; covers off/404, config on,
  event-only filtering, IP/token/header stripping, DSN rewrite, 10/min, size cap, methods, 502.
- `test/crash.test.ts`: fake reporter + `EventEmitter`; flush-then-exit, 2 s cap, second crash.
- `test/engine-errors.test.ts` (from the WIP commit): injected `engine` throws on intents and at a
  deadline, `INTERNAL` to sender, last good state, fatal at 3, retry.
- E2E needs a built `apps/web/dist` when `CI` is set (`vite preview`), so run the web build first.
