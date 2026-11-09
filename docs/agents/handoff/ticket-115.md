# Ticket #115 (TurnClock) — extension points and gotchas

Branch `agent/issue-115-turn-deadline-module-one-place-for-the-wake-up-its`, from #44 (engine throws, deadline retry), #48 (early re-arm), #34 (restore).

## The module

- `apps/server/src/room/turn-clock.ts`: `TurnClock` owns the one pending Turn wake-up, the retry
  back-off and the engine-throw count. `new TurnClock({ scheduler, engine, timing, log, onError,
  onTimeout })`:
  - `arm(state)` cancels the pending wake-up and keeps one for `state.turnDeadline` (`null`: none).
    It starts the retry back-off afresh but **not** the engine-throw count.
  - `cancel()` drops the wake-up **and the armed state**, so a hand-fired stale callback after the
    game ends does nothing.
  - `run(game, intent, actor)` is the only engine call: a throw is logged/reported through
    `onError` and gives `null`; the third throw in a row is `fatal`. A normal Rejection resets the
    count and is returned.
  - `onTimeout(applied)` is the Room's `commit(result, "TurnTimedOut")`. A `RejectionCode` return
    means the write failed, and the clock retries at 5 s, doubling to 60 s. A failed engine call
    retries on the same back-off. An early fire (`NOT_OFFERED` before `turnDeadline`) re-arms at
    the deadline; a stale `TurnTimedOut` (`turn` moved on) is ignored.
- The constants `ENGINE_THROWS_FATAL`, `DEADLINE_RETRY_MS`, `DEADLINE_RETRY_MAX_MS` now live in
  `turn-clock.ts`, not `game-room.ts`.

## GameRoom wiring

- The clock is created in `onCreate` **after** `this.log = this.log.child({ roomCode })`: a
  Colyseus Room subclass initialises `scheduler`/`engine`/`timing`/`log` after `super()`, so a field
  initializer would capture the defaults, and the fatal line must carry `roomCode`.
- A restored running game arms in `onCreate` (`else if (this.game) this.#clock.arm(this.game)`),
  not in `restore`, for the same reason. A stored game-over state still goes through `endGame`.
- `commit` calls `turnClock.arm(state)` unless the phase is `gameOver`; `endGame` and `onDispose`
  call `turnClock.cancel()`. Player intents call `turnClock.run`.
- The retention deletion has its own handle (`#cancelDeletion`), no longer sharing the Turn's.
- Do not name a getter `clock` on `GameRoom`: `Room` already has a `clock` member; the private
  accessor is `turnClock`.

## Tests

- `apps/server/test/turn-clock.test.ts` drives the module with `ManualScheduler` and engine stubs
  (no Room or socket): one wake-up, the `TurnTimedOut` call, early re-arm, stale wake-up, both
  retry back-offs and their reset, `fatal` at three throws and the reset, `cancel`.
- The Room-level behaviour still lives in `deadline-early.test.ts`, `engine-errors.test.ts`,
  `turn-timer.test.ts`, `game-end.test.ts` and `restore.test.ts`.

## For #117 (commit pipeline)

The clock is ready to move beside the pipeline: `run` is the engine seam, `onTimeout` is the
commit it drives, `onError` is `GameRoom.failed`. Keep `arm`/`cancel` calls at the same points
(after a successful write/broadcast, on game over, on dispose).
