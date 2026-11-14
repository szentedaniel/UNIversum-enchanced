# Ticket #235 (the summary counters) — extension points for #236–#238

Branch `agent/issue-235-rules-count-rent-fields-monopolies-and-bankruptcie`, from `main` after #234 (the Wealth series).

## What landed

- **`packages/rules/src/rules/summary.ts`** holds `GameSummary` (the four figures,
  plain JSON: `biggestRent`, `fieldsBought`, `monopolies`, `bankruptcies`),
  `emptySummary()`, the `recordPurchase`/`recordRent`/`recordMonopolies`/
  `recordBankruptcy` counters the rule areas call, and `summaryOf(events)`, the
  pure fold of a whole game's events into the same record. `summaryOf` is
  exported from `packages/rules/src/index.ts` with the types; `emptySummary`
  and the recorders are not (rule areas import `#rules/summary.ts`).
- **`GameState.summary: GameSummary`**, `STATE_VERSION` 9 → 10,
  `MIGRATIONS[9]` (`packages/rules/src/migrate.ts`) sets `emptySummary()`, and
  `packages/rules/test/fixtures/state-v10.json` is
  `JSON.stringify(playTurn(newGame()).state, null, 2)`.
- **`PublicView` omits `summary`** (`packages/rules/src/view.ts`), so #236 must
  add the field it exposes (and any protocol/web fixtures that build a view).
- **`fieldOwnerOf(state)`** and **`ownsGroup(ownerOf, group, owner)`** in
  `rules/pricing.ts` are the one owner lookup and the one Group ownership test;
  `isMonopoly` delegates to them, and the summary fold passes the owners it
  derives from the events.
- **Recorded at the emit sites:** `BuyLevel` (`rules/universities.ts`), `Buyout`
  (same), `BuyMuseum` (`rules/museums.ts`), `AcceptDeal` (`rules/deal.ts`), and
  `RentPaid`/`WentBankrupt` (`rules/charge.ts`).

## The choices that matter

- **What counts as bought:** `LevelBought` on an unowned Field, `BoughtOut` and
  `MuseumBought`. A build on an owned Field, a Deal transfer and a Bankruptcy
  hand-back do not count. `fieldsBought` only lists Players with at least one
  purchase (`{}` for none), so #237's "top buyer, ties and zero" sees no key.
- **Monopolies are detected from the Fields that change owner**, not from a
  before/after `isMonopoly` snapshot: `recordMonopolies` checks the Group of each
  gained Field after the ownership write, so a build passes no Field and records
  nothing. `AcceptDeal` records the recipient's Monopoly after the `give`
  transfer and the proposer's after the `take` transfer, which is also the order
  `summaryOf` folds them in; a Deal that completes one Group for each side records
  two entries in that order.
- **`monopolies` counts formations, not the Groups a Player holds at the end.**
  A player who loses a Group in a Deal and completes it again gets a second
  entry (pinned by the "lost by Deal and completed again" test in
  `summary.test.ts`): the spec defines the figure by the purchase or accepted
  Deal that completes the Group, and the result screen tells the loss and the
  regain as two swings. #236 shows the length of this list as the count.
- **`summaryOf` tracks Field owners itself** from the events (`LevelBought`,
  `BoughtOut`, `MuseumBought`, `DealAccepted`, `FieldsSold`, `WentBankrupt`), so
  it needs the events from the game's start. Do not use it on a mid-game event
  slice: it treats every Field as unowned at the start.
- **The biggest Rent is the biggest `RentPaid` amount**, an event tie keeps the
  first, and a Bankruptcy with nothing raised records a 0 Rent if one is emitted.
- **A migrated v9 game starts with empty counters.** Its earlier purchases,
  Monopolies and Bankruptcies are not recovered; its next purchases still detect
  Monopolies from the state's owners, so the counters stay correct from then on.

## Tests

- `packages/rules/test/summary.test.ts`: one test per figure through `apply` and
  `publicView`, Monopoly once, both Monopolies of one Deal in order, a Group lost
  by Deal and completed again as a second Monopoly, two Bankruptcies in order,
  and two seeded folds (`playRandomGame` for three `choiceSeed`s and a
  `playBotGame({ dealEvery: 2 })`) asserting `state.summary` equals `summaryOf`
  of the same game's events.
- `packages/rules/test/migrate.test.ts`: the v9 → v10 step (empty counters) and a
  v9 game played to its end; `playToEnd` is the shared loop for the v8 and v9
  finish tests.
