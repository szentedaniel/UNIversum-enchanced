# Ticket #30 (Quarantine / PCR tests): facts for later tickets

Branch `ticket/30-quarantine`.

## Rules (`packages/rules`)

- `PlayerState` gains `quarantineRounds: number | null` (null = not in Quarantine; 0 = still in until their next Turn start, R45) and `hasPcrTest: boolean` (F23: at most one). `setupGame` sets `null` / `false`. **STATE_VERSION not bumped** (same call as #25); #34 must include these fields in its first shape / migration.
- `rules/quarantine.ts` (imports only tx/constants, so no cycle): `quarantineChoice` phase `{ canBuyPcrTest, canUsePcrTest, pcrTestPrice }`, `enterQuarantine` (the `quarantine` entry in `LANDINGS`), `beginTurn(tx)`, `release(tx, player)`. Events `QuarantineEntered {player, rounds}`, `QuarantineReleased {player}`.
- **`passTurn` now emits `TurnPassed` and then calls `beginTurn(tx)`**, which sets the first phase of the new Turn: `awaitingRoll`, or `quarantineChoice` when rounds > 0, or it releases at 0 (emits `QuarantineReleased`) and goes on to `awaitingRoll`. #32 (game-end check at the top of passTurn) and #29 (Bankrupt) keep that order; any other "start of Turn" rule goes in `beginTurn`.
- `rules/quarantine-choice.ts`: Player intents `RollForTwelve`, `BuyPcrTest`, `UsePcrTest` (NOT_OFFERED when the phase flag is false; no new Rejection codes), event `QuarantineRoundUsed {player, roundsLeft}`, `PcrTestBought {player, amount}`, `PcrTestUsed {player}`. A 12 → `DiceRolled, QuarantineReleased, Moved, …landing…, TurnPassed` (normal `moveForward` + `landOn`, so it can stop at a #26 offer). A PCR release → `decide(tx, awaitingRoll)`: same Turn, fresh deadline.
- `TIMEOUT_OUTCOMES.quarantineChoice = quarantineChoiceTimeout` (round used, no penalty, Turn passes). #29 adds `selling` next to it.
- **#28 Chance PCR card:** set `hasPcrTest = true` (a second card is wasted, F23). The `canUsePcrTest` flag picks it up at the next quarantined Turn start.
- **#26 Rent while quarantined (spec story 50):** nothing here blocks it; don't check `quarantineRounds` when paying Rent to an owner.
- Tests: `test/quarantine.test.ts`. `quarantinedTurn(patch, seed)` gets to a quarantined Turn through play (2 Players, p1 times out, which draws no dice). `seedRolling(twelve)` searches hashed seeds. **Gotcha:** small or patterned raw seed words give correlated first dice (all-odd multipliers → first die always odd), so hash them (`mix`) first. `helpers.ts` `rollOffered(state)` sends `Roll` or `RollForTwelve` by phase; use it in loops that play many Turns (#26 should extend it to decline offers).
- The fixed `SEED`'s first roll is 9: from Field 31 that lands on Quarantine. The turn.test event-order test now starts so it lands on Start.

## Protocol

- Three new strictObject schemas in `PLAYER_INTENT_SCHEMAS`.

## Web

- `Game.tsx` (after #40's restyle): the choice panel is a `<section aria-label="Quarantine">` in the bottom card, with "Roll for 12" (lg), "Buy a PCR test (price)" and "Use your PCR test" shown only when the phase offers them. `send(type)` replaces `roll()`.
- **`NOTICES` set in `Game.tsx`:** event types that take the single toast ahead of routine events in the same push (#40 shows one toast per push, the first describable event, which would hide a notice behind `DiceRolled`). #28 should add `CardDrawn`/Tax there.
- `PlayerSummary.status?: string` shows a line on PlayerCard/PlayerChip ("In Quarantine: 2 · PCR test").
- Messages: `game_quarantine_rounds`, `game_roll_for_twelve`, `game_buy_pcr_test`, `game_use_pcr_test`, `game_in_quarantine`, `game_pcr_test_held`, `event_quarantine_*`, `event_pcr_test_*` (en/hu/de).
- E2E: no committed Quarantine spec. The server seed comes from the CSPRNG and there is no seed seam, so a quarantine can't be forced. I checked it by hand with a temporarily pinned seed `[-1809836808, -20819853, -1558109821, 183529820]` (first roll 2+6 → Field 8, then 1+3), on both desktop and iPhone. #45 meets it by acting on the offered options. `two-guests.spec.ts`: the `{ name: "Roll" }` match (not exact) also clicks "Roll for 12", on purpose.
