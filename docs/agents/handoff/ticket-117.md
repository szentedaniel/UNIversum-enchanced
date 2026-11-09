# Ticket #117 (GameDriver): extension points and gotchas

Branch `agent/issue-117-gameroom-s-commit-pipeline-one-module-that-runs-th`. A pure in-process
refactor: `GameRoom`'s commit pipeline — engine, store, broadcast, Turn deadline — moved into
`apps/server/src/room/game-driver.ts`. No stored state, protocol, wire or public interface changed.

## The module

- **`GameDriver`** (`apps/server/src/room/game-driver.ts`) owns everything between an accepted
  intent and the next wake-up. Its constructor takes `engine`, `scheduler`, `store`, `metrics`,
  `log`, `reporter`, `timing`, `roomCode`, plus callbacks the Room supplies: `readRoom()` (the
  snapshot's identity fields: `settings`, `roomName`, `creatorId`, `password`), `readState()` (the
  live `game`, `seats` and `endedAt`), `publish(state, message)` (broadcast; called only after the
  store wrote it), `onEnded(endedAt)` (the Room records the time and releases its Seats) and
  `onRetention()` (the Room disconnects).
- **Methods:** `start(game)` commits a state built by `setupGame` (no engine call, no events);
  `resume(game)` arms a restored game's deadline, or finishes a stored game-over state;
  `submit(game, intent, actor)` runs one intent and commits it; `endGame()` finishes the current
  state; `saveSeats(seats)` persists a Lobby change; `failed(error, message, intent)` logs and
  reports a bug outside the engine; `dispose()` cancels the Turn clock and the retention timer.
- **`Outcome`** is `{ rejected: RejectionCode } | { committed: GameState }`. Every committed state
  is already stored and published when the method returns; a Rejection (including `INTERNAL` from
  a failed write or engine throw) changed nothing.
- **Composed with `TurnClock`:** the driver owns a `TurnClock` (#115) for the engine's throw
  policy and the one Turn deadline, its retry back-off and early re-arm. `TurnClock.run` is the
  engine seam; its `onTimeout` commits with the driver. The driver does not re-implement the
  deadline.
- **One wake-up for the Turn, one for deletion:** the clock holds the deadline/retry wake-up; the
  driver's `#cancelDeletion` holds the retention timer `deleteAfterRetention` (24 h, `#store`,
  `#roomCode`) armed by `#end`.

## Gotchas

- **Moving the pipeline must not clone it back into the Room.** `GameRoom` only calls the driver
  from `startGame`, `play` (via `onIntent`), `onJoin`/`trySave` (Lobby writes) and `endGame`;
  `restore` schedules through `driver.resume`. Engine throws, failed writes and the `onIntent`
  catch around non-engine bugs all report through the driver's `failed`.
- **The driver is the one writer of the `StoredRoom` shape.** `#save` builds the snapshot;
  `saveSeats` is the Lobby escape hatch (join before the Seat is pushed, leave after it is
  removed). A new persisted Room field goes in `#save` only.
- **The driver keeps no game/Seat/end-time copy.** `readState()` is called at write time, so a
  deadline commit saves the Room's live Seats even after a rejoin or a Lobby change.
- **`GameTiming` and `SeatRecord` now live in `game-driver.ts`** and are re-exported from
  `game-room.ts`, so `server.ts`, `config.ts` and the test helpers keep their imports. A future
  module that needs neither a Room nor a socket can import them from the driver directly.
- **Construction ordering:** `onCreate` creates the driver after `this.log = this.log.child({
  roomCode })` and before `metrics.trackRoom`; the driver captures the Room's dependencies there.
  `restore()` runs first and only unlists; the restored deadline is armed by `driver.resume` after
  the driver exists. Keep the driver's `log` creation after that narrowing, or its lines lose the
  Room code.
- **`test/game-driver.test.ts` is the socket-free suite:** a `ManualScheduler`, a fake failing
  store and a throwing engine drive the commit, deadline, live-Seat, end and retention paths
  without starting Colyseus. `test/turn-clock.test.ts` owns the clock's own retry/early-re-arm
  cases.
