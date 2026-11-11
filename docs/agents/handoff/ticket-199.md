# Ticket #199 (a game with only Bots left) — extension points and gotchas

Branch `agent/issue-199-a-game-with-only-bots-left-ends-after-retention`, from main at `43f5400`.

## What landed

- **One "a Guest is connected" fact.** `GameDriver.#guestsConnected()`
  (`apps/server/src/room/game-driver.ts`) asks `readState().seats` and
  `isSeatConnected`: a Bot's Seat never counts. `#botPlays` returns `false`
  when no Guest is connected, so no commit and no connection change arms a
  Bot wake-up; `#playBot` re-checks it, so a stale wake-up changes nothing.
- **A Bot-only game ends after its Seat retention.** `refreshBot` arms
  `#armBotRetention` when the last Guest's connection goes (and cancels it when
  a Guest comes back, before it re-arms the Bots). The wake-up is
  `BOT_ONLY_RETENTION_MS` (`60_000`, exported from `game-driver.ts`) after the
  drop — the Room's usual Seat retention (the Lobby's 60 s hold), not the 24 h
  ended-Room deletion.
- **The end records no result.** The wake-up calls `#end(game)` with the state
  as it stands: `endedAt` is set, the phase stays what it was (no `GameEnded`,
  no publish, nothing to publish to), the Seats stay, and the usual 24 h
  `deleteAfterRetention` + `onRetention` disconnect follow. `#end` and
  `dispose` cancel the retention handle so it can never fire on an ended or
  disposed Room.
- **A returning Guest resumes.** A reconnect or Guest-token `takeBack` calls
  `refreshBot`: it cancels the retention and re-arms the open Decision's Bot
  (or the Guest answers it) exactly as #198 left it.
- **`resume` now asks `#botPlays`.** A restored game arms a Bot only when a
  Guest is connected, which at boot never happens: a stored Bot Seat no longer
  acts 1.5 s after a restart (this supersedes #196's note). No retention is
  armed at boot either, so a deploy longer than the retention does not end
  running games; the Room waits for its Guests as #198 documented.
- **No web, protocol or rules change.** The Room sends no new message; an
  ended-by-retention Room is never seen by a connected Guest.
- **Tests.** `apps/server/test/bots.test.ts`: `botTurnGame()` (one Guest + one
  Bot, stopped at the Bot's open Decision) and `describe("a game with only Bots
  left")` — no Bot intent past its pause and no `DiceRolled` by the Bot, the
  game ends at `droppedAt + BOT_ONLY_RETENTION_MS` with `endedAt` set, the
  phase not `gameOver`, its Seats kept, no `GameEnded`, and `store.ended()`
  holding it; then a Guest reconnecting inside the retention keeps the game
  alive and the Bot plays again. Real SDK clients and the `ManualScheduler`.

## Extension points and gotchas

- **The Turn clock is not paused.** While the retention runs, the open
  Decision's Turn deadline still fires (a `TimedOut` + `TimeoutPenaltyPaid`
  landed in the window in the test), so a game already within ~60 s of its
  Minute limit can end with a normal result before the retention. Pausing the
  clock would need the state's `turnDeadline` moved, which only the rules
  engine may write (ADR-0003).
- **The retention counts from the last drop, not from the last commit.** A
  Turn timeout's commit does not re-arm it; only `refreshBot` (a connection
  change) arms or cancels it. If you add a new place that ends a game, cancel
  `#cancelBotRetention` there (as `#end` does).
- **`#guestsConnected` is per-Seat and live.** A Seat restored with
  `sessionId: null` counts as absent, and a dropped Guest keeps their stale
  `sessionId` until `takeBack`; both are what `isSeatConnected` already
  handles for `gauges()`.
- **A Guest back after the retention** finds the ended game through
  `sendCurrent` (their Seat is still stored; the hold was released). Nothing
  tells them it was ended without a result — out of this ticket's scope.
- **The web has no Bot-only state to show**, so do not add a message for this
  case; the Room is empty when it happens.
