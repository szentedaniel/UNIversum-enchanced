# Ticket #34 (SQLite RoomStore / restore on boot / retention) — extension points

Branch `ticket/34-room-store`.

## Rules (`packages/rules`)

- `migrate(stored: unknown): GameState` (src/migrate.ts, exported). `MIGRATIONS[n]` turns stateVersion n into n+1; empty now (STATE_VERSION 1 = first stored shape). Throws on missing/invalid/newer `stateVersion` or a gap.
- `test/migrate.test.ts` + `test/fixtures/state-v1.json` (= `roll(newGame()).state`). Guard test: **the current-version fixture must have the same key shape as `roll(newGame()).state`** (phase contents ignored). So **#26/#30/any ticket that adds/removes a GameState/PlayerState/FieldState key fails this test.** Fix: bump `STATE_VERSION`, add `MIGRATIONS[old]` (derive the new field), commit `state-v<new>.json` (JSON.stringify(roll(newGame()).state, null, 2)), add it to the `fixtures` list in the test. Never edit an old fixture. (Pre-release shortcut if the orchestrator prefers: regenerate state-v1.json instead — nothing is deployed yet.)

## Server (`apps/server/src`)

- `store/room-store.ts`: `RoomStore` { `unfinished()`, `ended()`, `save(room, events)` (one transaction), `isCodeInUse`, `delete`, `events(code)`, `close` }. `StoredRoom<G>` = { code, settings, seats: LobbySeat[], game, endedAt }. **Sync** API (node:sqlite is sync); Postgres later needs async + per-Room intent queue.
- `store/sqlite-room-store.ts`: `openSqliteRoomStore(path)`; tables `rooms(code PK, version, state JSON, ended_at)`, `events(id, code, version, events JSON)`; WAL, synchronous=NORMAL, busy_timeout. Manual `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK`.
- **Server-owned Room fields** (Seats, settings) live in the `state` JSON next to `game`. #35 (guest token hash on Seats) / #36 (Room name, password hash in settings) add fields there: add them as optional or handle missing values on restore (no migration chain for the server part).
- `room/game-room.ts`: `store` + `scheduler` injected by `createGameServer({ store, scheduler })` (store now REQUIRED). `commit()` = save → broadcast → schedule deadline; failed write → `INTERNAL` to sender, nothing broadcast. `onJoin` saves the new Seat first (failed write → join refused); a Lobby `onLeave` saves; `onDispose` of a Lobby (not on shutdown) deletes it from the store ("emptied Lobby deleted right away"). Running games set `autoDispose = false` + `lock()` at Start and on restore.
- `#shuttingDown` (set in `onBeforeShutdown`): onLeave/onDispose change nothing during shutdown. Keep it that way in #35.
- Restore: `restoreRooms({ store, scheduler, onError })` in server.ts → `migrate` → `matchMaker.createRoom(GAME_ROOM, restoreOptions(stored))` (a `RestoreRoom` class instance in options, so client JSON can't fake it) → `GameRoom.restore()`: roomId = code, `claimRoomCode`, Seats with `sessionId: null`, reschedules `turnDeadline` (past → fires at once). Un-migratable Rooms are skipped and stay stored.
- **#35:** restored Seats have `sessionId: null` and the restored running game is `lock()`ed → nobody can join until Guest-token rejoin exists. A restored Lobby keeps autoDispose → disposes (and is deleted) after Colyseus' seat-reservation timeout if nobody joins; #35 should start the 60 s Seat hold for restored Lobby Seats instead. `onJoin` now refuses when `seats.length >= maxPlayers` (phantom restored Seats count).
- **#32:** call `room.endGame()` when the game-over phase arrives (in `commit`): records `endedAt`, saves, cancels the Turn wake-up, schedules delete + `disconnect()` 24 h later (`store/retention.ts` `RETENTION_MS`, `deleteAfterRetention`). Ended Rooms were not restored before #226; since #226 `restoreRooms` restores them as ended (Podium for the rematch), the Room keeps its stored `endedAt` and `GameDriver.resume` arms its retention; boot only arms the deletion for an ended Room whose restore failed (`store.ended()` carries the snapshot since #226).
- Room codes: `reserveRoomCode(code => store.isCodeInUse(code))`; `claimRoomCode` for restores.
- `internal-server.ts`: `startInternalServer({ port, host })` → `/healthz` 200, `/readyz` 503 until `ready()`, else 404. **#43: add `/metrics` here.** Config: `INTERNAL_PORT` (default 9464, 0 = any), `databasePath` = `DATA_DIR/rooms.sqlite`.
- `main.ts`: mkdir dataDir → open store → internal server → createGameServer → listen → restoreRooms → `internal.ready()`; `server.onShutdown` closes store + internal server. Logs via console (pino: #43).
- compose: `INTERNAL_PORT: "9464"`, healthcheck now `fetch('http://127.0.0.1:9464/readyz')` (not verified in Docker: daemon wasn't running).

## Tests

- `test/helpers.ts` `startTestServer({ databasePath?, scheduler?, wrapStore? })` → adds `databasePath`, `store`, `restored`, `room(code)` (live GameRoom, for state no client can see yet), and `eventually(check)`. `stop()` now shuts the server down FIRST (clients connected, like a deploy), then closes the store. Restart = `stop()` then `startTestServer({ databasePath, scheduler: new ManualScheduler(t) })`; then `scheduler.advanceTo(t)` runs overdue deadlines.
- `test/restore.test.ts` (restart, overdue deadline, Lobby restore, un-migratable Room, failed write, retention), `test/room-store.test.ts`, `test/room-code.test.ts`, `src/internal-server.test.ts`.
- E2E: playwright webServer gets `DATA_DIR` = fresh mkdtemp (or `E2E_DATA_DIR`) and `INTERNAL_PORT=0`.

## Seen while merging

- `two-guests.spec.ts` (mixed-devices) is flaky after the #40 merge: the final phone tap on Zurich (field 5) sometimes doesn't select it (~2/8 runs, `selected-field` not found). Client-side only; unrelated to the store.
