# Ticket #128 (one game-end Ranking, shared ownership queries) — extension points

Branch `agent/issue-128-...`. Internal rules refactor: **no state shape, protocol, server or web change**, so no `STATE_VERSION` bump and no migration.

## Rules (`packages/rules`)

- **`rules/game-end.ts` `rank(state, players, { by })` is the one ordering.** Default `by: "wealth"` orders most Wealth (R77), then more cash, then the earlier Seat (F25); `by: "monopolies"` puts the Monopoly count first and then uses the same Wealth chain (R79). It reads each Player's Wealth and (when asked) Monopoly count once per call, decorates the Players, sorts, and returns `PlayerState[]` best first.
- **`richest`** is `rank(...)[0]`; **`mostMonopolies`** takes the leader of the monopoly ranking and requires its count to be at least 3 (so a game with no holder still has no winner); **`standingsOf`** is the winner, then `rank` of the non-Bankrupt others, then `rank` of the Bankrupt others. A tie-break or end-condition change therefore lands in `rank` (or `checkGameEnd`) once.
- **`standingsOf` remains the only ranking `view.ts` reads** (`publicView.standings`); tests pin the order through `apply`/`publicView` in `test/game-end.test.ts` (Wealth/cash/Seat ties, more Monopolies first, tied Monopolies by Wealth, standings ties).
- **`rules/pricing.ts` ownership queries:** `isMonopoly(state, group, owner)` now takes the owner, so `monopoliesOf` asks it per Group and `rentOf` passes `fieldState.owner`; `museumsOf` is exported and `superMonopolyOwner` compares it with the static `MUSEUMS.length` in `game-end.ts` instead of walking ownership itself; `fieldsValue` sums `valueOf` for every owned Field, so a Museum's 400,000 comes from `valueOf` alone.
- `test/game-end.test.ts`'s `owned(state, owner, groups, museums)` lets a test give several owners Fields in one state; `GROUP_FIELDS` now covers Groups 1–6 and `STANFORD` (29) is the harmless landing for tests that must not overwrite a Group-4 Field.
