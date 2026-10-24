# Ticket #50 (the server holds the next decision until the Playback ends) — extension points and gotchas

Branch `ticket/50-playback-hold` (on `v2-modernization`). Implements ADR-0004 for
the rules engine, the protocol, the Room server and the client's gating; the
local Playback timeline, the toast stepping and the Board's animation wiring
stay in #51.

## Rules (`packages/rules`)

- **`src/playback.ts`** is the one place an event's length lives:
  `PLAYBACK_MS: Readonly<Record<GameEvent["type"], number>>` (a new event fails
  to compile until it has a length) and `playbackOf(events)` = the sum, with
  `Moved` scaled by `steps`. `PLAYBACK_MS.Moved` is **per Field** (160 ms), not
  per event. Starting lengths: dice 450, hop 160, Chance card 7 000, one beat
  600 for money/notice events, 0 for `TurnPassed`/`OfferDeclined`. Both are
  exported from `#index.ts`; the web's timeline module (#51) uses the same two
  names. Do not add a second duration table anywhere.
- **`GameState.actsAfter`**: `ctx.now + playbackOf(events)` of the last accepted
  intent. `apply` fixes it (and the deadline) **after** `handler.run`, once the
  event list is complete. `setPhase` no longer sets a deadline: it marks
  `tx.phaseSet`, `setFinalPhase` also marks `tx.finalPhase`, and `apply` writes
  `turnDeadline = final ? null : turnDeadlineFrom(actsAfter, ctx.turnLimitMs)`.
  A handler that never changes phase leaves the old deadline; the invariant
  test would catch that (every current handler ends in `passTurn`/`decide`/
  `setFinalPhase`).
- **`PLAYBACK_RUNNING`** (rules rejection + protocol `REJECTION_CODES` + web
  text) is checked in `apply` after the stale-Turn, actor and phase checks, and
  only for `handler.actor === "player"`. `TurnTimedOut` is never held. The
  order matters: an illegal-phase intent still gets `NOT_OFFERED`, not
  `PLAYBACK_RUNNING`.
- **`turnDeadlineFrom(start, turnLimitMs)`** keeps its shape but `start` is
  `actsAfter` now. `TURN_SLACK_MS`'s comment now says it covers network lag
  only.
- **`STATE_VERSION = 2`**; `MIGRATIONS[1]` (in `migrate.ts`) sets
  `actsAfter = turnDeadline - TURN_LIMIT_MS - TURN_SLACK_MS`, or `endsAt` when
  there is no deadline. The stored shape has no Turn-limit override, so the
  migration uses the production constants. Fixture `test/fixtures/state-v2.json`
  (= `playTurn(newGame()).state`) is committed; never edit `state-v1.json`.
- **`publicView`** carries `actsAfter`; `turnTimer.endsAt - turnTimer.limitMs`
  equals it, so the ring's start is `actsAfter` whether or not the server's
  timing override is in play.

## Test helpers (`packages/rules/test/helpers.ts`)

- `accept`/`reject`/`roll`/`rollOffered`/`rollOnto`/`playTurn` now default
  `now` to `max(T0, state.actsAfter)` via `readyAt(state)`, and `playTurn`
  advances its clock to each decision's `actsAfter`. An explicit `now` is
  still used as given (that is how the `PLAYBACK_RUNNING` tests work). Local
  helpers in a test file that default `now = T0` must move to
  `state.actsAfter` or they fail with `PLAYBACK_RUNNING`.
- Deadline assertions now count from the Playback: use
  `state.turnDeadline === state.actsAfter + TURN_LIMIT_MS + TURN_SLACK_MS` (or
  `playbackOf(applied.events)` instead of a hard-coded now).
- `invariants.test.ts`: the "fresh deadline" property is now
  `turnDeadline = actsAfter + limit + slack` plus `actsAfter >= step.now`.
  The simulation's move clock (`turnDeadline - 1`) is past `actsAfter` by
  construction; no change was needed in `simulation.ts`.

## Room server

- No timing logic changed: the single wake-up still fires at `turnDeadline`,
  which is now later. `apps/server/test/playback.test.ts` proves an early
  Player intent is refused and changes nothing, and that the timeout wake-up
  fires at the later deadline. `restore.test.ts` has the v1-fixture restore.
- **Server tests that send two intents in a row** must advance the
  `ManualScheduler` to the previous push's `view.actsAfter` first
  (`game-room.test.ts`'s `play` helper does it for every intent;
  `turn-timer.test.ts`/`restore.test.ts` do it per step). Advancing to
  `actsAfter` never fires a deadline (the deadline is 23 s later).

## Web client

- `Game.tsx`'s `usePlaybackOver(actsAfter, clockOffset)` snapshots the server's
  clock in state and re-reads it with one `setTimeout` at `actsAfter + 20`; it
  returns `now >= actsAfter`. It is called before the `if (!push)` return
  (hooks order). Every decision control is gated by it: `canRoll`, `offer`,
  `quarantineChoice`, the Sale and pick trays (`sale`/`singlePick` are `null`
  until it passes), and the "other Player is choosing" lines.
- `TurnRing` uses `leftMs - limitMs` **without clamping to the limit**: a
  positive delay keeps the ring full until `endsAt - limitMs` (= `actsAfter`),
  a negative one starts a ring mounted mid-Turn. Do not clamp it back.
- `Board.tsx`: `currentSale()`/`currentPick()` return `null` until the push's
  `actsAfter` by the server's clock, and `syncPick` schedules a `playbackTimer`
  for the boundary (it used to only re-arm for the Auto-sell warning). Taps
  during the hold fall through to the Field card instead of a hidden pick.
- `#51` still owns: the pure timeline module, the toast stepping, the Board's
  animation queue, "local Playback finished" gating, and the podium wait. This
  ticket gates on `actsAfter` **only**, and the podium still appears on the
  push, not after the final Playback.

## E2E / load test

- `apps/e2e/tests/test-hooks.ts`: the pushed view carries `actsAfter` (since #71
  the hooks use the rules engine's `PublicView`).
  Made-up views pushed through `showView` must set `actsAfter` to
  `hooks.serverNow()` (#64; pick-tray, sale-tray, podium specs do).
- `two-guests.spec.ts` samples every animation frame in-page
  (`window.playbackProbe`/`stopPlaybackProbe`) during the first Roll and
  asserts no decision control is visible while
  `Date.now() + clockOffset < actsAfter - 25`, and the current Player's control
  appears afterwards. A Playback is at least 450 + 2×160 ms, so the hold window
  is long enough to sample on a slow CI box. Its `playTurn` resolves **every**
  decision a Roll can stop at — an offer, a Sale, a Doubler or Erasmus pick —
  through the tray and loops until the Turn passes (a pick's travel can lead
  to another decision); each control's `toBeVisible` is the Playback wait. Any
  new decision phase the Roll can reach needs a case there, or the spec times
  out polling for the next Turn.
- Full-game e2e: the game still ends on the 120 s minute limit in wall-clock
  time, so the 240 s guard holds; the loop's controls are found through
  Playwright auto-wait. A Chance draw adds 7 s of Playback inside the Turn,
  not to the game's length.
- `apps/loadtest/src/worker.ts`: `act(view, serverOffset)` waits
  `max(0, view.actsAfter - (Date.now() + serverOffset))` before the 1–5 s think
  time, where `serverOffset = message.now - Date.now()` at receipt. The bots
  therefore never send an intent the server refuses as `PLAYBACK_RUNNING`.
