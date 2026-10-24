# Ticket #26 (Universities) — extension points for #27–#33, #38, #39

Branch `ticket/26-universities` (merged with v2-modernization incl. #25, #42).

## Rules engine

- **Board data** (`board.ts`): `FieldInfo.values` = Value by Level `[0, 1.0B, 1.2B, 1.6B, 2.2B]` for Universities, `null` elsewhere; `MAX_LEVEL = 4`. Museums (#27) may give themselves `values` too, or special-case in `pricing.ts`.
- **`rules/pricing.ts`**: `valueAt(field, level)`, `valueOf(state, field)`, `isMonopoly(state, group)`, `rentOf(state, field)` (0 when unowned; ×1.4 Monopoly via integer tenths). #27 adds Museum Value/Rent here; #31 adds the Doubler (plain Rent × (count+1), no Monopoly, F10); #29's sale value = 90% of `valueOf`; #32's "3 Monopolies" can use `isMonopoly`.
- **`rules/pass-turn.ts`**: `passTurn`, `awaitingRoll`, `TurnPassed` event moved here from `turn.ts` (re-exported from `turn.ts`, so old imports still work). **Rule areas reached from a landing must import `passTurn` from `#rules/pass-turn.ts`, not `#rules/turn.ts`** — otherwise oxlint `import/no-cycle` fails (turn → landing → area → turn). #32's game-end check goes at the top of `passTurn` in pass-turn.ts.
- **`rules/charge.ts`**: `charge(tx, payer, amount, pay)` — every Charge goes through it. Placeholder for cash < amount: the Player pays all their cash (money never negative, none created). **#29 replaces that branch** with the solvency rule (`selling { shortfall, resume }` / Bankrupt); `pay(amount)` credits the payee and emits the event (RentPaid). For F12 the owner callback gets the raised amount.
- **`rules/universities.ts`**: phase `offer { field, levels: LevelOffer[] }` (`LevelOffer = { level, price }`, only affordable, cheapest first); intents `BuyLevel { level }` and `DeclineOffer {}` (both end the Turn via passTurn); events `LevelBought { player, field, level, price }`, `OfferDeclined { player, field }`, `RentPaid { player, owner, field, amount }`. `landOnUniversity`: other's → Rent then `return` (comment marks where **#27 adds the Buyout** offer: extend the `offer` phase with `buyout: number | null`, and let the landing `decide` after Rent); own/unowned → `levelOffers(field, level, cash)` (exported).
- A timeout during an offer = penalty + Turn passes (no TIMEOUT_OUTCOMES entry needed).
- **View**: `PublicView.fields` is `FieldView[]` = `FieldState & { value, rent }` (exported `FieldView`). Add Museum numbers/sale value in `pricing.ts` and they flow through.
- **Test helpers** (`packages/rules/test/helpers.ts`): `rollOnto(state, field, now?)` (places the current Player so the roll lands there; a start before Start pays the Round bonus — pick Fields ≥ 13 or assert the owner's gain), `withField(state, id, patch)`, `playTurn(state)` (roll + decline any offer → `{ rolled, state }`). Tests that just need "the Turn passes" should `rollOnto(state, START_FIELD)` — every other Field will soon stop at a decision.

## Server tests

Real seeds are random, so a roll may stop at an offer. `apps/server/test/game-room.test.ts` has `play(clients, view, intent)` and `playTurn(clients, view)` (roll + decline). turn-timer.test.ts declines inline.

## Protocol

`BuyLevel` schema: `level: z.int().min(1).max(MAX_LEVEL)`; `DeclineOffer`: just `turn`.

## Web

- `screens/Game.tsx`: `OfferPanel` (data-testid `offer`, buttons "Level N · price" + "Decline"; title Buy/Build on) — #27 adds Museum buy and Buyout buttons here. `FieldDetails` under the tapped Field (owner · Level · Value · Rent, testid `field-numbers`; `selected-field` still holds just the name). Toast cases for LevelBought/OfferDeclined/RentPaid.
- `board/board.ts`: per University an owner ring (white Graphics `tint`ed with `PLAYER_COLORS[seat]`, in fieldLayer) and a `building` Container in pawnLayer with v1's raw house sprites stacked by Level (`loadHouse()` via `Assets.load` of `#assets/images/characters/haz_*.png`, `stack()` = v1 Building.jsx offsets, scale 0.3). Synced from the view in `syncFields`, called from `placeAll` (i.e. after the move animation). **#38** swaps these for atlas frames with baked owner colours.
- Messages added: `offer_*`, `field_level/unowned/value/rent`, `event_level_bought/offer_declined/rent_paid` (hu uses "tandíj" for Rent, as v1 did).

## E2E gotcha

The footer/toast re-flow resizes the Board after a push, so `fieldCenter` read right after a push can be stale; two-guests.spec.ts wraps the Zurich tap in `expect(...).toPass()`. The e2e buys the first offer at Level 1 and checks both views show the owner.
