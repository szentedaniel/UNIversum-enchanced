# Ticket #29 (Sale / Auto-sell / Bankrupt): facts for later tickets

Branch `ticket/29-sale-bankruptcy`.

## Rules (`packages/rules`)

- **`rules/charge.ts`** is the one solvency rule. `charge(tx, payer, pending: PendingCharge)`; `PendingCharge` (exported from index) = `{kind:"rent", amount, owner, field} | {kind:"tax", amount} | {kind:"chanceCard", amount} | {kind:"timeoutPenalty", amount}` (plain JSON). The callback API of #26 is gone: **charge.ts now credits the payee and emits the event itself** (`RentPaid` / `TaxPaid` / `ChanceChargePaid` / `TimeoutPenaltyPaid`; the event declarations stay in their areas). A new Charge kind = one union member + one `payTo` case.
  - cash ≥ amount → paid. cash + Σ sale value of the Player's Fields ≥ amount → `decide(selling { shortfall, resume: pending })` (callers already stop on `tx.decided`). Else `goBankrupt`.
  - `goBankrupt(tx, payer, pending)`: raised = cash + sale value of every Field; Fields → `{owner:null, level:0}`, Doubler cleared if on one; cash 0, `bankrupt = true`; then the Charge event with `amount = raised` (owner gets exactly that on Rent, F12), then `WentBankrupt {player, fields}`. The Turn then passes normally (passTurn skips Bankrupt). **#32:** the "≤1 non-Bankrupt left" check runs in passTurn after this.
  - Helpers exported for other areas: `fieldsOf(state, player)`, `saleValueOfAll`, `autoSellPicks(state, player, target)` (cheapest sale value first, tie by Field id, stops as soon as proceeds ≥ target — spec, not v1's "strictly above"), `sellFields(tx, player, fields, auto)` (emits `FieldsSold {player, fields, amount, auto}`, returns Fields to the Bank, clears the Doubler on them — **#31: R62 is done here; Doubler code needn't handle sales**), `payFromCash`.
- **`rules/sale.ts`**: Player intents `SellFields { fields }` (all the Player's, no duplicates, else `NOT_OFFERED`; sale value < Shortfall → new Rejection **`SHORTFALL_NOT_COVERED`**) and `AutoSell {}`. After the sale the pending Charge is paid from cash, then the landing resumes: **Rent on a University offers the Buyout if now affordable** (`offerBuyout` exported from universities.ts), else the Turn passes. `autoSellAndPay(tx)` for the timeout.
- `TIMEOUT_OUTCOMES.selling` = Auto-sell + Charge, then `payTimeoutPenalty`, then passTurn (no Buyout).
- `payTimeoutPenalty` ≤ 100,000 cash: penalty `LOW_CASH_TIMEOUT_PENALTY` (100,000, constants.ts); Bankrupt if cash + all sale value < 100,000 (`TimeoutPenaltyPaid {amount: raised}` + `WentBankrupt`); else Auto-sell until proceeds ≥ 100,000 (`FieldsSold auto`), cash pays the rest, `TimeoutPenaltyPaid {amount: 100000}`.
- **View:** `PublicView.autoSell: FieldId[] | null` (Auto-sell's picks during a Sale). Hand-built PublicViews need it.
- No GameState/PlayerState/FieldState keys added → #34's fixture unchanged.
- Tests: `test/sale.test.ts` (solvency on Rent, Sale, Auto-sell, timeout penalty, Bankrupt, and a 40-game random play loop checking money ≥ 0 / Bankrupt never current / Bankrupt owns nothing). Tax/Chance Sale cases in tax.test.ts / chance.test.ts.

## Protocol

`SellFields` schema: `fields: int[0..31][]`, 1–32 items; `AutoSell`: just `turn`. `SHORTFALL_NOT_COVERED` in `REJECTION_CODES`.

## Web

- **`src/pick/sale.ts`** (pure, unit-tested in `test/sale-pick.test.ts`): `saleFor(view, me)` → `SalePick {key, shortfall, charge, cash, pickable (cheapest first), autoSell}` or null; `pickKey(view)` = `turn:turnDeadline`; `toggledPicks`, `salePickedValue`, `saleMarks(sale, view, picks, msLeft)` → `PickMarks {pickable, picked, ringed}`; `AUTO_SELL_WARNING_MS` 5,000. **#39/#31 (Doubler, Erasmus picks): reuse `PickMarks` + `Board.setPick`** — add a `doublerFor`/`erasmusFor` next to `saleFor` and route taps in `Board.tsx` `onFieldTap`.
- `uiStore.salePicks {key, fields}` + `toggleSalePick(key, id)`; `salePicksFor(picks, key)` (stable empty list for a stale key).
- **Board:** `setPick(marks | null)`: non-pickable Fields greyed (`art.setDimmed`, container tint 0x5a6070), picked lifted + green ring/fill, `ringed` orange (5 px). During a pick, `tap()` only considers pickable Fields (same reach). `art.setRing` takes an optional `fill` colour. Board test-hook getter `pick`.
- `Board.tsx`: `onFieldTap` toggles a pick during this client's Sale (never opens the card), and `syncPick` closes the Field card, pushes marks, and sets one timeout for the 5 s warning.
- `screens/SaleTray.tsx` (testid `sale-tray`, `data-board-obstacle`): Charge · Cash line, `Shortfall: X` (testid `sale-shortfall`), TimerRing + TurnRing, sr-only `<meter>` + bar, chips (`Remove {field}` buttons), `Auto-sell` and `Sell N for X` (disabled until covered or while an intent is pending). Replaces the bottom card during this client's Sale; others see "{name} is selling Fields" (testid `sale-waiting`) on the Turn card. **#39 adds the checklist / inspect mode here.**
- Toasts: `FieldsSold` (`event_fields_sold` / `event_auto_sold`), `WentBankrupt` (in `NOTICES`). Player status shows `game_bankrupt` ("Bankrupt"/"CSŐD"/"Bankrott"); pawns of Bankrupt Players were already hidden by #24.
- **Test hooks:** `showView(view)` sets `roomStore.push` to a made-up view (test builds only) — the way to reach states a random game can't be steered into; `pick()` returns the Board's marks. e2e `test-hooks.ts` declares `FullView`, `room()`, `showView`, `pick`.
- E2E `sale-tray.spec.ts` (both single-browser projects): taps snap/toggle, chips, Sell unlock, Chance-next-to-Berlin snap, 5 s orange ring, Bankrupt panel. Nothing is sent to the server; must finish before the real 23 s deadline push overwrites the view.
