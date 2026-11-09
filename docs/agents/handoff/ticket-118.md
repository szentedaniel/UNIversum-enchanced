# Ticket #118 (server boot module): extension points and gotchas

Branch `agent/issue-118-server-boot-module-one-place-that-wires-config-sto`. Startup wiring now lives
in one place: `apps/server/src/server.ts`'s `startServer(config, deps?)`.

## The boot path

- `startServer(config, deps)` opens the store (unless `deps.store`), starts the internal port, defines
  the Rooms, listens, restores the stored Rooms, then calls `internal.ready()`; only then does it
  resolve. It returns `{ port, internalPort, restored, stop() }`; `port`/`internalPort` are the
  actual bound ports (`PORT=0`/`INTERNAL_PORT=0` pick free ones and are logged on "Server listening").
- `stop()` calls `server.gracefullyShutdown(false)`, so `onBeforeShutdown` logs "Server shutting
  down", every Room stops, then `onShutdown` closes the store, closes the internal server and logs
  "Server stopped". It is idempotent. The store it opened **or was handed** is closed here.
- `main.ts` is now config → logger → `startServer(config, { log })`. It still logs the
  production `GAME_TURN_LIMIT_MS`/`GAME_MINUTE_MS`/`GAME_SEED` warning before boot.
- `restoreRooms` is private to `server.ts` (no longer exported). It restores unfinished Rooms with
  `matchMaker.createRoom(GAME_ROOM, restoreOptions(stored))` and schedules retention for ended
  Rooms; `restoreOptions`/`RestoreRoom` stay in `room/game-room.ts`.

## Deps seam

`StartServerDeps = Partial<GameServerOptions> & { crashHandlers?: boolean }`. Tests pass a `store`,
`scheduler`, `metrics`, `log`, `reporter`, `engine`, `limits`, `timing`, `errorReporting`, and set
`gracefullyShutdown: false` plus `crashHandlers: false` to avoid process signal/crash hooks.
`createGameServer` stays exported for a server that is not yet listening.

## Gotchas later tickets must know

- **Anything that must happen at boot goes in `startServer`, not `main.ts`.** Order is: store →
  internal server → game server → listen → restore → `ready()`. Adding a step after restore but
  before `ready()` is the way to keep `/readyz` honest.
- **`/readyz` is 503 from the moment the internal server binds until restore finishes.** Do not
  call `internal.ready()` earlier.
- **The test helper is the boot path.** `apps/server/test/helpers.ts`'s `startTestServer` calls
  `startServer` with the seams above, so every Room test exercises the production order; it passes
  `crashHandlers: false` and `gracefullyShutdown: false`. `restored` comes from `startServer`'s
  return, and `stop()` closes the store.
- **Spawned-server proof stays in `src/main.test.ts`** (plain Node type stripping + production
  NDJSON lines); it expects exactly "Server listening", "Rooms restored", "Server ready", then the
  two shutdown lines. Keep `startServer`'s log lines and their order.
- **Boot tests** live in `apps/server/src/server.test.ts` (ports/log order, restore-before-return,
  store closed after Rooms). Run them with
  `pnpm exec vitest run apps/server/src/server.test.ts`.
