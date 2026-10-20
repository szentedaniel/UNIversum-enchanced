# Ticket #45 (full 4-Guest Playwright game) — extension points and gotchas

Branch `ticket/45-full-game-e2e` (on `v2-modernization`). The spec is
`apps/e2e/tests/full-game.spec.ts`; it runs once in the `mixed-devices`
project (`MIXED` in `apps/e2e/playwright.config.ts` matches `two-guests` and
`full-game`).

## Test-only game clocks (`GAME_TURN_LIMIT_MS`, `GAME_MINUTE_MS`)

A 15-minute Room cannot reach game over inside CI, so the e2e server shortens
Turns and minutes. Production defaults are untouched.

- **Rules seam:** `Ctx.turnLimitMs?` (`intents.ts`) reaches `setPhase` via
  `turnDeadlineFrom(now, ctx.turnLimitMs)` (`tx.ts`, `constants.ts`).
  `SetupInput.turnLimitMs?` / `minuteMs?` (`setup.ts`) set the first deadline
  and `endsAt = now + settings.minuteLimit * minuteMs`. `publicView(state, {
  turnLimitMs })` (`view.ts`, `ViewTiming`) reports the same `limitMs` the
  deadline used. All optional; rules tests and production omit them.
- **Server:** `GameTiming` (`room/game-room.ts`) is a `createGameServer`
  option (`server.ts`) stored on every `GameRoom` as `timing`. `startGame`
  spreads it into `setupGame`, `run` passes `turnLimitMs` into the engine
  `Ctx`, and **both** `publicView` calls (`sendCurrent`, `commit`) pass it, so
  the ring and the deadline never disagree. Any new `publicView` call site in
  the Room must pass `this.timing` too.
- **Config:** `config.timing` from `GAME_TURN_LIMIT_MS` / `GAME_MINUTE_MS`
  (positive integers; unset by default, documented in `.env.example`).
  `main.ts` hands it to `createGameServer`; server tests use
  `startTestServer({ timing })` (see `turn-timer.test.ts`, which now runs with
  a 1 s Turn and 10 s minutes).
- **E2E:** `playwright.config.ts` `SERVER_ENV` sets `GAME_TURN_LIMIT_MS=8000`
  and `GAME_MINUTE_MS=8000` for **every** e2e spec: a Turn deadline is 8 s +
  3 s slack, and a 15-minute Room ends after 120 s. Other specs are short
  enough not to hit either; a future long-running e2e spec will.

## Full-game spec (`apps/e2e/tests/full-game.spec.ts`)

One test, four contexts (2 desktop Chromium + 2 iPhone WebKit, all
`locale: en-US`), ~2.1 min in CI:

1. Creator opens `/create` with 4 Players and 15 minutes; the other three join
   from the home screen by typing the code.
2. The loop reads `window.universumTest.room().push.view` (the newest of the
   four), finds the current Player's page and acts only on the phase:
   - `awaitingRoll` → Roll; `quarantineChoice` → Roll for 12.
   - `offer` → first Level or the Museum (declines Buyouts); this is how the
     game gets owners, so `RentPaid` events follow.
   - `selling` → taps own Fields cheapest first through `fieldCenter` until
     the "Sell N for X" button enables, then commits.
   - `placingDoubler` / `choosingErasmus` → taps the first offered Field
     through `fieldCenter`, then commits.
3. On the third Guest's first Turn it goes `setOffline`, the page closes and a
   fresh page returns to the same public Player id (the held Seat). The Turn
   timeout is deliberately taken on the next `awaitingRoll` (11 s); the spec
   waits for `turn` to advance and checks the `TimedOut` push.
4. At `gameOver`, every screen must show the podium with exactly one
   `[data-place="1"]` for the same Player, the same title, no Roll button, and
   `room().push.view.phase` must carry the same winner; a skipped Buyout is
   intentional (the test never takes another Player's Field).

`tapField` re-reads `fieldCenter` and polls `window.universumTest.pick()` for
the pick marks, so a tap lost to a layout change is retried (the known #26
flake). Every click/tap waits for a version bump after the intent, never for a
screen alone.

## Test hooks (`apps/e2e/tests/test-hooks.ts`)

- `FullPhase` is the real phase union (`offer` optional keys, `selling`,
  picks, `gameOver` winner/reason); add a member when a new decision phase
  arrives or the spec's exhaustive switch fails to compile.
- `FullView.version` and `room().push.{events, seq}` are declared and read by
  the spec; `events` is only `{ type }[]`, so a spec that needs a payload must
  widen it.

## Gotchas seen

- `setOffline(true)` in WebKit on a loaded machine does not always surface the
  reconnect overlay before the page closes. The full-game spec treats the
  overlay as best-effort; `reconnect.spec.ts` owns the overlay assertion, and
  the held Seat is proven by the Guest-token rejoin (`me` unchanged).
- The first version waited for the dropped player's timeout while offline and
  once saw the Turn stuck for 30 s under heavy load; the timeout is now taken
  on a connected Turn after the rejoin, and the wait is 45 s.
- Playwright's non-CI mode uses `vite dev`; with `CI=true` (the CI job and the
  check command in `docs/agents/implementer.md`) it runs `vite preview`, so
  `TEST_HOOKS=1 pnpm --filter @universum/web run build` must have produced
  `apps/web/dist` first.
- The game policy always buys the cheapest Level/Museum. Without owners there
  is no `RentPaid`, and a Sale needs a Charge bigger than cash; if a future
  rules change removes these offers, the coverage assertions fail first.
- The spec's `Date.now()` guard is 240 s of play; the Minute limit is 120 s, so
  a hung loop fails before Playwright's 300 s test timeout.
