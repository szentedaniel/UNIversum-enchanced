# Ticket #117 (GameDriver): extension points and gotchas

Branch `agent/issue-117-gameroom-s-commit-pipeline-one-module-that-runs-th`. A pure in-process
refactor: `GameRoom`'s commit pipeline — engine, store, broadcast, Turn deadline — moved into
`apps/server/src/room/game-driver.ts`. No stored state, protocol, wire or public interface changed.

## The module

- **`GameDriver`** (`apps/server/src/room/game-driver.ts`) owns everything between an accepted
  intent and the next wake-up. Its constructor takes `engine`, `scheduler`, `store`, `metrics`,
  `log`, `reporter`, `timing`, `roomCode`, plus four callbacks the Room supplies: `room()` (the
  snapshot's identity fields: `settings`, `roomName`, `creatorId`, `password`), `publish(state,
  message)` (broadcast; called only after the store wrote it), `ended(endedAt)` (the Room records
  the time and releases its Seats) and `retention()` (the Room disconnects).
- **Methods:** `start(game, seats)` commits a state built by `setupGame` (no engine call, no
  events); `resume(game, seats, endedAt)` arms a restored game's deadline, or finishes a stored
  game-over state; `submit(game, intent, actor, seats, endedAt)` runs one intent and commits it;
  `timeOut(turn)` is the deadline callback; `endGame()` finishes the current state; `dispose()`
  cancels the one wake-up.
- **`Outcome`** is `{ rejected: RejectionCode } | { committed: GameState }`. Every committed state
  is already stored and published when the method returns; a Rejection (including `INTERNAL` from
  a failed write or engine throw) changed nothing.
- **One wake-up:** `#cancelWakeUp` holds the Turn deadline, its retry back-off or the retention
  timer. `#scheduleDeadline` resets the retry count; `#end` swaps the deadline for
  `deleteAfterRetention` (24 h, `#store`, `#roomCode`).

## Gotchas

- **Moving the pipeline must not clone it back into the Room.** `GameRoom` only calls the driver
  from `startGame`, `play` (via `onIntent`) and `endGame`; `restore` schedules through
  `driver.resume`. Error reporting for engine throws and failed writes lives in the driver;
  `GameRoom.failed` remains only for the `onIntent` catch around non-engine bugs.
- **Two writers build a `StoredRoom`:** the driver's `#save` (game snapshots and events, with the
  `seats`/`endedAt` it was given) and the Room's `save` (Lobby actions, `trySave`, reading the
  Room's live fields). A new persisted Room field needs both, or move the extra write onto the
  driver.
- **`GameTiming` and `SeatRecord` now live in `game-driver.ts`** and are re-exported from
  `game-room.ts`, so `server.ts`, `config.ts` and the test helpers keep their imports. A future
  module that needs neither a Room nor a socket can import them from the driver directly.
- **Restore ordering:** `restore()` sets the fields and unlists; the deadline is armed later in
  `onCreate` by `driver.resume`, after the logger is narrowed to `roomCode`. Keep the
  driver's `log` creation after that narrowing, or its lines lose the Room code.
- **The Room tests did not change.** `test/game-driver.test.ts` is the socket-free suite: a
  `ManualScheduler`, a fake failing store and a throwing engine drive the back-off, early re-arm,
  end and retention paths without starting Colyseus.
