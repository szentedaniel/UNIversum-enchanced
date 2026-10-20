# Ticket #31 (Doubler and Erasmus): facts for later tickets

Branch `ticket/31-doubler-erasmus` (on `v2-modernization` at `b0dd39d`).

## Rules (`packages/rules`)

- **Doubler** (`src/rules/doubler.ts`): phase `placingDoubler { fields }` (the current Player's Universities and Museums, Field order), Player intent `PlaceDoubler { field }`, event `DoublerPlaced { player, field, count }`. Landing with no own Field decides nothing, so the roll passes the Turn (R59). One token: placing on the Field that already carries it stores `count + 1`, anywhere else stores `count: 1` (R60, F11). `passTurn` follows immediately (the ~1 s pause is v1's animation; the client animates the push).
- **Erasmus** (`src/rules/erasmus.ts` + `src/rules/erasmus-travel.ts`): phase `choosingErasmus { fields }` (every University/Museum whose owner is `null` or the current Player, Field order), Player intent `TravelErasmus { field }`. Travel uses `moveForward` with `(target − position + 32) % 32`, then `landOn` (Round bonus, then the normal offer/rent), then `passTurn` when nothing decided (R64, R65). Nothing to pick → the roll passes at once, no penalty (F16).
- **Import cycle gotcha:** `landing.ts` must import each area's landing function, so the Erasmus landing lives in `erasmus.ts` and the travel handler in `erasmus-travel.ts`. Putting both in one module makes `landOnErasmus` a TDZ error on load. New corner handlers that need `landOn` must split the same way.
- **Rent** (`src/rules/pricing.ts`): `baseRentOf` = Rent without Monopoly/Doubler (University Value × rate; Museum 75,000 × Museums). `rentOf` applies the Doubler as `base × (count + 1)` and, when the Doubler is there, skips the Monopoly ×1.4 for a University; a Museum keeps its count multiplier (R61, F10). `FieldView.rent` therefore shows the Doubler's effect to everyone.
- **R62** is already in `charge.ts` (`returnToBank` clears the token on sold/Bankrupt Fields); the Doubler area does not handle Sales.
- **Timeouts:** both phases use the default outcome (penalty then pass); no `TIMEOUT_OUTCOMES` entry (R18).
- **View** (`src/view.ts`): `PublicView.pickOptions: PickOption[] | null` carries each option's effect so the tray holds no rules:
  - `{ kind: "doubler", field, rent, rentAfter }` — `rent` is the current `rentOf` (Monopoly included), `rentAfter` is `baseRentOf × (countAfter + 1)`, stacking when the token is already there.
  - `{ kind: "erasmus", field, steps, passesStart, bonus }` — `steps` is the forward distance; `bonus` is `ROUND_BONUS` when `passesStart`, else `null`.
    Export: `PickOption` from `@universum/rules` (types only; the web may not import runtime values from it).
- No `GameState`/`PlayerState`/`FieldState` keys were added, so `STATE_VERSION` and #34's fixture are unchanged.
- Tests: `test/doubler.test.ts` (R59–R63, F10, F11), `test/erasmus.test.ts` (R64, R65, F16, timeout, view options). Test helpers now resolve the new phases: `playTurn` loops through offer/placingDoubler/choosingErasmus; `sale.test.ts`'s `anyOption` picks for them. `rollOnto` may pass Start and pay the Round bonus — rent assertions add it when present.

## Protocol

`PlaceDoubler { turn, field }` and `TravelErasmus { turn, field }` strictObject schemas with `field` in `0…31` (`packages/protocol/src/schemas.ts`). No new Rejection codes.

## Web

- **`src/pick/pick.ts`** (unit-tested in `test/pick.test.ts`): `singlePickFor(view, me)` → `{ kind, key, pickable, options }` or `null`; `selectedPick(pick, selection)` drops a choice from an earlier decision; `singleMarks(pick, field)` → `{ pickable, picked: [field], ringed: [] }`. Reuses `pickKey` and `PickMarks` from `#pick/sale.ts`.
- **`uiStore.singlePick { key, field }` + `choosePick(key, field | null)`**: one choice at a time, replaced by a tap, cleared by the chip or a `null`.
- **`Board.tsx`**: `currentPick()` mirrors `currentSale()`; `onFieldTap` routes Sale → toggle, single pick → `choosePick`, else the Field card. `syncPick` pushes `setPick(singleMarks(...))` and closes the Field card; taps snap to pickable Fields via the renderer's existing filter. `syncPick` still owns the Sale warning timer.
- **`screens/PickTray.tsx`** (testid `pick-tray`, `data-board-obstacle`): title, effect line (`pick-effect`), Turn timer (`TimerRing` + `TurnRing`), chip (`Remove {field}`), one commit button that is disabled until a choice and names it ("Put the Doubler on …", "Travel to …"). It fills the same bottom slot as `SaleTray`; `Game.tsx` chooses Sale → single pick → Field card → Turn card. Another Player's pick shows `pick-waiting` on the Turn card.
- Messages: `pick_*` in `messages/{en,hu,de}.json` (`pick_doubler_title`, `pick_erasmus_title`, `pick_hint`, `pick_remove`, `pick_doubler_rent`, `pick_erasmus_ahead`, `pick_erasmus_start`, `pick_doubler_commit`, `pick_erasmus_commit`, `pick_waiting`). Regenerate Paraglide after message edits.
- **#39:** genericize this tray rather than forking it — the same `SinglePick`/`PickMarks`/`uiStore` pattern is the seam for the checklist and inspect mode. The Sale tray is still separate (`saleFor`/`SaleTray`).

## E2E

`apps/e2e/tests/pick-tray.spec.ts` (both single-browser projects) uses `showView` with a made-up `placingDoubler`/`choosingErasmus` view and the supplied `pickOptions`; nothing is sent to the server. `test-hooks.ts` `FullView` gained `doubler` and `pickOptions` (`FullPickOption`). Assertions: tap snapping (Veszprém → Budapest), one-choice replacement, chip removal, the Rent/Fields-ahead/bonus effect and the commit label. The real 23 s deadline push overwrites the fake view, so keep the test under that (as `sale-tray.spec.ts` does).
