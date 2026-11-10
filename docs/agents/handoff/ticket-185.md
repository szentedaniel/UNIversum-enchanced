# Ticket 185 — the starting cash Room setting

- The setting's path, layer by layer: `packages/protocol/src/messages.ts` (`STARTING_CASHES`,
  `RoomSettings.startingCash`, `DEFAULT_SETTINGS.startingCash`), `packages/protocol/src/schemas.ts`
  (`createOptionsSchema` takes `z.literal(STARTING_CASHES)` and defaults it), `packages/rules/src/state.ts`
  (`Settings.startingCash`), `packages/rules/src/setup.ts` (`cash: settings.startingCash`),
  `apps/server/src/room/game-room.ts` (`onCreate` destructures it into `this.settings`), and
  `apps/web/src/screens/CreateRoom.tsx` (a `Segments` row over `STARTING_CASHES`). A further Room
  setting repeats exactly these stops (#186 Round bonus, #187 Turn timer).
- The rules package repeats the value list as a literal union (`1_500_000 | 2_500_000 | 4_000_000`)
  instead of importing `STARTING_CASHES`: the web bundle may import only rules _types_ (and the
  `board`/`playback` subpaths), so protocol/messages keeps the one list the web validates and renders.
  The zod literal is the only validation; the rules engine trusts `Settings`.
- `STATE_VERSION` is 3. `MIGRATIONS[2]` in `packages/rules/src/migrate.ts` adds
  `startingCash: START_CASH` to the settings, narrowed with the file's own `isObject`, and a running
  game keeps the cash its Players already hold (the setting only decides a new game's cash).
  `packages/rules/test/fixtures/state-v3.json` is the generated snapshot; a later state-shape change
  bumps the version and adds `state-v4.json` rather than editing it.
- `GameRoom.restore` now sets `this.settings = { ...DEFAULT_SETTINGS, ...stored.settings }`, so a Room
  stored before a setting existed comes back on the default; `apps/server/test/restore.test.ts` pins
  this with a Lobby whose snapshot lacks `startingCash`. A new required `RoomSettings` field therefore
  needs no room-store migration, only the default in `DEFAULT_SETTINGS`.
- `LobbyMessage.settings` and `PublicView.settings` already carry `RoomSettings`, so the Lobby and a
  running game needed no message change. `LobbyListingMetadata` does **not** carry the starting cash:
  the Lobby list's non-default marker is #188.
- The Create Room segments show `formatCompactCash` (`apps/web/src/text.ts`: currency + compact, e.g.
  "1,5 M Ft" / "Ft 1.5M" / "1,5 Mio. Ft"), which keeps three choices on one 375 px row; the Lobby
  row uses full `formatMoney` through `lobby_starting_cash`. The Lobby's settings grid is now
  `sm:grid-cols-2 lg:grid-cols-4`; a fifth setting needs a layout change.
- Tests that pin it: `packages/protocol/test/schemas.test.ts` (default, each value, refusals),
  `packages/rules/test/setup.test.ts` (`R7` per value), `packages/rules/test/migrate.test.ts` (a
  stored state before the setting loads with `START_CASH`), `apps/server/test/game-room.test.ts`
  (create → Lobby settings → every Player's `cash` in the first view), and the restore test above.
- The test fixtures that hand-build a `PublicView` or `StoredRoom` need `startingCash` in their
  `settings` literal; `packages/rules/test/helpers.ts` `newGame` defaults it to `START_CASH`, so rule
  tests that do not care about the setting keep working.
- #187's Turn timer has to keep the server's e2e override winning: `startGame` passes
  `this.timing.turnLimitMs` to `setupGame`, `publicView(state, timing)` reads `timing.turnLimitMs` for
  the ring, and `GameRoom` hands the same `GameTiming` to `TurnClock` (`TurnClockTiming` takes its
  `turnLimitMs`); the setting must sit under those overrides.
