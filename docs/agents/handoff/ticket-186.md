# Ticket 186 — the Round bonus Room setting

- The setting's path repeats #185's, layer by layer: `packages/protocol/src/messages.ts`
  (`ROUND_BONUSES`, `RoomSettings.roundBonus`, `DEFAULT_SETTINGS.roundBonus`),
  `packages/protocol/src/schemas.ts` (`createOptionsSchema` takes `z.literal(ROUND_BONUSES)` and
  defaults it), `packages/rules/src/state.ts` (`Settings.roundBonus`),
  `packages/rules/src/setup.ts` (`roundBonus: settings.roundBonus`),
  `apps/server/src/room/game-room.ts` (`onCreate` destructures it into `this.settings`), and
  `apps/web/src/screens/CreateRoom.tsx` (a `Segments` row over `ROUND_BONUSES`). The rules package
  repeats the value list as a literal union (`150_000 | 250_000 | 400_000`) for the same web-bundle
  reason #185 records; the zod literal is the only validation.
- The payment itself is `packages/rules/src/rules/movement.ts`'s `moveForward`: it reads
  `tx.state.settings.roundBonus` for both the cash and the `RoundBonusPaid` event, so passing Start,
  landing on Start, the Quarantine escape roll and Erasmus travel all pay the Room's value.
  `packages/rules/src/rules/erasmus.ts`'s `erasmusRoute` reads `state.settings.roundBonus` too, so
  the Erasmus pick's `bonus` in `PublicView.pickOptions` matches what travelling pays.
  `ROUND_BONUS` in `packages/rules/src/constants.ts` stays as today's default and the migration's
  value; no rule reads it any more.
- #190's Scholarship transfer and any later Chance card that pays the Round bonus must go through
  `moveForward` (or read `state.settings.roundBonus`), never `ROUND_BONUS`, or a non-default Room
  pays the default.
- `STATE_VERSION` was 6 when #186 landed: `MIGRATIONS[5]` adds `roundBonus: ROUND_BONUS` to the
  settings and `packages/rules/test/fixtures/state-v6.json` is that shape's generated snapshot; the
  v1–v5 snapshots stay untouched. #187's Turn timer then made it 7 (`MIGRATIONS[6]`,
  `state-v7.json`), so read the version from `STATE_VERSION`. A running game keeps the money its
  Players already hold: the setting decides a new game's payments.
- `GameRoom.restore` still sets `this.settings = { ...DEFAULT_SETTINGS, ...stored.settings }`, so a
  Lobby stored before this field comes back on 250,000 with no room-store migration.
  `LobbyMessage.settings` and `PublicView.settings` already carry the whole `RoomSettings`;
  `LobbyListingMetadata` still carries no Round bonus, so the Lobby list's non-default marker is
  #188's.
- The Lobby's settings grid is now `sm:grid-cols-2 lg:grid-cols-3` (was `lg:grid-cols-4`): five rows
  in one column on mobile, two rows of three on desktop, which also fits #187's sixth setting. The
  Round bonus row renders full `formatMoney` through `lobby_round_bonus`; the Create Room segments
  use `formatCompactCash` (e.g. "Ft 150K").
- Tests that pin it: `packages/protocol/test/schemas.test.ts` (default, each value, refusals),
  `packages/rules/test/setup.test.ts` (`R10` per value in the settings),
  `packages/rules/test/turn.test.ts` (passing and landing on Start per value),
  `packages/rules/test/erasmus.test.ts` (payment and pick `bonus` per value),
  `packages/rules/test/migrate.test.ts` (a stored state before the setting loads with `ROUND_BONUS`),
  `apps/server/test/game-room.test.ts` (create → Lobby settings → first view), and
  `apps/e2e/tests/lobby-list.spec.ts` (the form's 400K choice reaches the Lobby row).
- The test fixtures that hand-build a `Settings`, `RoomSettings` or `PublicView` need `roundBonus` in
  their `settings` literal; `packages/rules/test/helpers.ts` `newGame` defaults it, so rule tests that
  do not care about the setting keep working.
