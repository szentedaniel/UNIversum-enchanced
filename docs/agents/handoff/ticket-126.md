# Ticket #126 (one solvency module): facts for later tickets

Branch `agent/issue-126-charge-one-solvency-module-that-also-settles-the-t`.
Pure refactor of `rules/charge.ts`, `rules/timeout.ts` and `rules/sale.ts`: no
GameState/PlayerState key, no `PendingCharge` shape change, no migration and
no wire change.

## The one solvency module

`rules/charge.ts` owns the whole sequence, not just the decision:

- `charge(tx, payer, pending, how?: { sell: "ask" | "auto" })` — cash that
  covers the Charge pays it. Otherwise `"ask"` (the default) opens the Sale
  for the Shortfall and sets `tx.decided`; `"auto"` (the Timeout penalty)
  Auto-sells first and then pays from cash; both go Bankrupt when cash plus
  every Field falls short.
  - The `"auto"` branch fires when `cash <= amount`, not only when cash is
    short: R19's flat penalty says a Player at exactly 100,000 cash still
    sells cheapest first and keeps the change (`sale.test.ts`, "even with
    100,000 in cash"). Above the threshold the amount is 10% of cash, so
    `cash > amount` always pays from cash and no Field moves.
- `settleAfterSale(tx, payer, pending, picks?)` — the Sale's outcome: sells
  `picks` (the Player's choice) or, when omitted, Auto-sell's cheapest Fields
  for `pending.amount - cash` (equal to the open Sale's `shortfall` by
  construction), then pays the Charge from cash. `FieldsSold.auto` is
  `picks === undefined`. The old `payFromCash` + `sellFields` pairing is gone;
  do not add an exported helper that lets a caller sequence sell-then-pay.
- `timeoutPenaltyOf(tx, playerId)` — the R19 amount rule, now here: above
  `TIMEOUT_PENALTY_THRESHOLD` cash, 10% rounded; at or below it
  `LOW_CASH_TIMEOUT_PENALTY` (100,000). `timeout.ts` is only
  `charge(tx, player, timeoutPenaltyOf(...), { sell: "auto" })`.
- Unexported now: `fieldsOf`, `sellFields`, `payFromCash`, `goBankrupt`.
  Exported queries stay: `autoSellPicks` (the view reads it) and
  `saleValueOfAll` (the `SellFields` handler's `SHORTFALL_NOT_COVERED` check).

## `rules/sale.ts`

- `autoSellAndPay(tx)` is the timeout's R69 step (R69: Auto-sell the open
  Sale, then the penalty): it is `settleAfterSale` on the phase's `resume`.
- `afterCharge(tx, playerId, pending)` is what follows a settled Sale: the
  Buyout after a Rent on a University (R52), skipped when `tx.decided`, then
  `passTurn`. The `SellFields` and `AutoSell` handlers both end with it.

## Behaviour pins and gotchas

- Event order is unchanged: `FieldsSold` → the Charge event → (`TurnPassed`
  or a timeout's penalty beats). `goBankrupt` keeps ADR-0005's two beats
  (`ticket-82.md`).
- `timeout.test.ts` gained "R19: above the threshold cash pays the penalty,
  so no Field is sold" — the guard against an `"auto"` mode that sells Fields
  whenever the Charge exists.
- The seeded `playRandomGame` loop in `sale.test.ts` and the invariants still
  cover money ≥ 0 and a Bankrupt Player never being current.
