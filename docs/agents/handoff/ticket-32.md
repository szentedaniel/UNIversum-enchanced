# Ticket #32 (Game end / result screen) — extension points

Branch `ticket/32-game-end`. Merged with #31 (Doubler/Erasmus).

## Rules (`packages/rules`)

- **`rules/game-end.ts`** is the whole rule: `GameEndReason` (`"lastPlayer" | "timeUp" | "superMonopoly" | "monopolies"`), the `gameOver { winner, reason }` phase, the `GameEnded { winner, reason }` event, and `checkGameEnd(tx)`.
- **Where it runs:** the first line of `passTurn` (`rules/pass-turn.ts`), so at every Turn change — after the Turn's own events, before `turn += 1`, `TurnPassed` and `beginTurn`. When the game ends there is **no `TurnPassed`** and no new Turn: `turn` stays at the Turn that just finished, `currentPlayer` becomes the winner, and the phase is `gameOver`. Every path that ends a Turn goes through `passTurn`, so a new ending needs no new call site.
- **Order (spec R76–R79):** ≤ 1 non-Bankrupt Player (the survivor wins), then `ctx.now >= state.endsAt` (the richest non-Bankrupt), then a Super-monopoly (all 4 Museums), then ≥ 3 Monopolies. Ties: Wealth desc, then cash desc, then Seat asc. With 0 non-Bankrupt (unreachable through play) the richest Player wins, so there is always exactly one winner.
- **`GameState.turnDeadline` is `number | null`**, `null` only at game over. `setPhase` still sets a deadline for every decision; **`tx.ts` `setFinalPhase(tx, phase)`** sets a phase and clears the deadline — use it for any later terminal phase. `TurnTimedOut` rejects (`NOT_OFFERED`) when the deadline is null.
- **`publicView`:** `players: PlayerView[]` (`PlayerState` + `wealth`), `turnTimer: TurnTimer | null` (null at game over), `turnDeadline: number | null`. `fieldsValue` moved from `rules/tax.ts` to `rules/pricing.ts`, next to `wealthOf` (cash + Fields' Value, Museums at 400,000).
- **Tests** (`test/game-end.test.ts`): `deadlineOf(state)` (test/helpers.ts) narrows the nullable deadline in any test. `endTurnOn(state, field, level)` in that file ends the current Player's Turn without money moving: they land on a Field they own (a Museum, or a Level-4 University far enough round the ring that the roll never passes Start).

## Server (`apps/server`)

- **`GameRoom.commit`** calls `endGame()` when the accepted state's phase is `gameOver` (after the broadcast); otherwise `scheduleDeadline(state)`. `endGame()` records `endedAt`, saves once more with it (a failed save is logged, not fatal), releases the Seat holds, cancels the wake-up and schedules the 24 h retention deletion + `disconnect()`.
- **`scheduleDeadline` no-ops on a null deadline**, so an ended Room never wakes up; `timeOut` also returns when `endedAt` is set.
- A game-over state stored as unfinished (a crash between the final save and `endGame`) is finished in `onCreate` after the "Room restored" log; `restore` reschedules nothing for it.
- **Metrics:** `gauges()` reports `state: null` once `endedAt` is set, so `rooms{state="playing"}` drops an ended Room (it stays tracked until its deletion; `players_connected` still counts its connected Seats).
- **Tests** (`test/game-end.test.ts`): the Minute-limit path is driven by `scheduler.advanceTo(start + 50 min)` (the Turn deadline fires then). test/helpers.ts `withDeadline(message)` narrows a started game's `turnDeadline` for the other server tests.

## Web (`apps/web`)

- **`components/Podium.tsx`** renders whenever `view.phase.kind === "gameOver"` (inside both Game layouts, `z-40`; the reconnect overlay is `z-50`). It is a 2-1-3 podium of the top three (winner's block in `playerLook(seat).color`, F28), the other Players below (greyed when Bankrupt), and a link to `/rooms` (`back_to_list`).
- **`pick/podium.ts`** `podiumOrder(players, winner)` is the ranking (unit-tested in `test/podium.test.ts`). The winner is always place 1, then non-Bankrupt by Wealth/cash/Seat, then Bankrupt.
- **`Game.tsx`** hides the bottom card while the podium is up; the Turn ring only renders when `view.turnTimer !== null` (the same guard is in `SaleTray`, `PickTray` and `Board.tsx`'s sale marks).
- **`MinutePill`** takes `clockOffset` (from `push.clockOffset`) and ticks on the server's clock.
- Messages (en/hu/de): `podium_wins`, `podium_reason_{last_player,time_up,super_monopoly,monopolies}`, `podium_place`, `podium_wealth`, `event_game_ended`.
- **E2E** `podium.spec.ts` (both single-browser projects) shows a made-up 4-Player game-over view through `showView`; `FullView` in `apps/e2e/tests/test-hooks.ts` now carries `turn`, `players[].seat/name/cash/wealth`, `doubler`, `pickOptions` and nullable `turnDeadline`/`turnTimer`.

## Gotchas seen while merging

- #31's two Erasmus F16 tests built a state where one Player owns every Field, which is now also a Super-monopoly: the Turn change ends the game. They now assert the game end instead of `awaitingRoll`.
- `checkGameEnd` runs **before** `turn += 1`, so an ended game's `turn` is the Turn that just finished (not the next one).
