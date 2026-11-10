# Ticket 187 — the Turn timer length Room setting

- The setting's path repeats #185's: `packages/protocol/src/messages.ts` (`TURN_LIMITS` =
  `[10_000, 20_000, 30_000]`, `RoomSettings.turnLimitMs`, `DEFAULT_SETTINGS.turnLimitMs`), the
  `createOptionsSchema` literal in `packages/protocol/src/schemas.ts`, `packages/rules/src/state.ts`
  (`Settings.turnLimitMs`), `apps/server/src/room/game-room.ts` (`onCreate` destructures it into
  `this.settings`), and `apps/web/src/screens/CreateRoom.tsx` (a `Segments` row over `TURN_LIMITS`,
  labelled `create_turn_seconds` = "10 s" / "10 mp" / "10 s"). The rules package repeats the value
  list as a literal union (`10_000 | 20_000 | 30_000`), as it does for the starting cash.
- The setting drives every deadline through one expression in two places: `packages/rules/src/setup.ts`
  (`turnDeadlineFrom(now, turnLimitMs ?? settings.turnLimitMs)`) and `packages/rules/src/apply.ts`
  (`turnDeadlineFrom(actsAfter, ctx.turnLimitMs ?? tx.state.settings.turnLimitMs)`). `publicView`'s
  `turnTimer.limitMs` reads `timing.turnLimitMs ?? state.settings.turnLimitMs`
  (`packages/rules/src/view.ts`). In all three the e2e `GameTiming.turnLimitMs`
  (`GAME_TURN_LIMIT_MS`) wins when set; `TurnClock` arms at the state's `turnDeadline`, so the
  Timeout penalty fires at the Room's deadline without further plumbing.
- `STATE_VERSION` is 6. `MIGRATIONS[5]` in `packages/rules/src/migrate.ts` adds
  `turnLimitMs: TURN_LIMIT_MS` to the settings; a running game's existing deadlines were counted
  with 20 s, and its next decisions keep that length. `packages/rules/test/fixtures/state-v6.json`
  is the generated snapshot; a later state-shape change bumps the version and adds `state-v7.json`.
- `GameRoom.restore`'s `{ ...DEFAULT_SETTINGS, ...stored.settings }` defaults a stored Lobby from
  before the setting to 20 s, so no room-store migration is needed.
- Hand-built `PublicView`/`Settings` literals in tests now need `turnLimitMs`; `newGame` in
  `packages/rules/test/helpers.ts` defaults it to `TURN_LIMIT_MS`.
- The Lobby grid still shows Players, Minute limit, starting cash and password: #187's acceptance
  criteria did not ask for a Turn timer row, and #188 owns the Lobby list's non-default marker.
  Adding the row later needs a layout change (`sm` 2 / `lg` 4 columns).
- e2e: `GAME_TURN_LIMIT_MS` is gone from `apps/e2e/playwright.config.ts`, because the server's
  override would hide the setting from every screen. The specs that need short Turns pick the
  shortest 10 s Turn timer on the Create screen instead: `startGame(page, browser, { turnLimitMs:
  10_000 })` and `full-game.spec.ts` select "10 s", while the rest keep the 20 s default;
  `apps/e2e/tests/helpers.ts` has `RoomChoices`, the now-exported `createAndJoin` and `startLobby`
  (the Start click both it and `startGame` use). `apps/e2e/tests/turn-timer.spec.ts`
  pins the ring's inline `animation-duration` to `10000ms` and the view's `turnTimer.limitMs` to
  10 000. The override itself stays covered by `apps/server/test/turn-timer.test.ts`.
- Tests that pin the setting: `packages/protocol/test/schemas.test.ts` (default, each value,
  refusals), `packages/rules/test/timeout.test.ts` (each length's deadline and ring; every decision;
  the override beating a 30 s Room), `packages/rules/test/migrate.test.ts` (a stored state before
  the setting loads with `TURN_LIMIT_MS`), `apps/server/test/game-room.test.ts` (create → Lobby →
  view settings and ring), `apps/server/test/turn-timer.test.ts` (a 10 s Room without an override:
  deadline, ring and Timeout penalty; the override beating a 30 s Room), and
  `apps/server/test/restore.test.ts` (a stored Lobby defaults the setting).
