# Ticket #27 (Museums and Buyouts) — extension points for #28, #29, #31, #32, #33, #45

Branch `ticket/27-museums-buyouts` (merged with v2-modernization incl. #30, #38).

## Rules engine

- **`offer` phase** (declared in `rules/universities.ts`, the one owner): `{ field, levels: LevelOffer[], buyout?: number, museum?: number }`. Optional keys are **omitted** (never `undefined`) when not offered. University offer: `levels` only. Buyout: `levels: []` + `buyout` (price). Museum: `levels: []` + `museum` (price). `DeclineOffer` works for all three (`OfferDeclined {player, field}`). Loops that "buy the first offer at Level 1" must check `levels.length > 0` (server `game-room.test.ts` has `levelOffer(view)`).
- **Intents:** `BuyMuseum {}` (`rules/museums.ts`, `museumIntents` in HANDLERS), `Buyout {}` (in `universityIntents`). Both NOT_OFFERED when the phase lacks the key. No new Rejection codes.
- **Events:** `MuseumBought { player, field, price }`, `BoughtOut { player, owner, field, level, price }`. Museum Rent reuses `RentPaid`.
- **Landing:** `landOnMuseum` (LANDINGS.museum): unowned + cash ≥ 400,000 → offer; own → nothing; another's → `charge` Rent → Turn passes (no Buyout). `landOnUniversity`: another's → `charge` Rent, then `if (!tx.decided && level < MAX_LEVEL && buyout <= cash)` decide the Buyout offer. **#29:** if `charge` opens a Sale (`decide`), the Buyout check is skipped by `tx.decided`; if your Sale resumes the landing, decide whether the Buyout follows.
- **Pricing (`rules/pricing.ts`):** `valueOf` = Museum 400,000 when owned (any Seat, F2), 0 unowned; `saleValueOf` = round(90% × Value) (360,000 for a Museum) — **#29 use this**; `buyoutPriceOf` = 200% × Value; `rentOf` Museum = 75,000 × Museums the owner holds (private `museumsOf`). **#31** multiplies `rentOf` by (count+1) for the Doubler: for Museums keep the count multiplier, for Universities drop the Monopoly. `MUSEUM_VALUE` in `board.ts` (#28 Tax / #32 Wealth: Museums at 400,000 = `valueOf`).
- **R55:** the Buyout only rewrites `fields[field].owner`; `state.doubler` is untouched, so the Doubler stays (tested on a hand-built `doubler`).
- **View:** `FieldView` gained `sale` (Bank sale value). Hand-built `FieldView`s (web `test/field-facts.test.ts`) need it.
- No GameState/PlayerState/FieldState keys added (Museum owned = `{owner, level: 0}`), so #34's shape guard is unaffected.
- Tests: `test/museums.test.ts`, `test/buyouts.test.ts`. Quarantine's 12-roll test now lands on Museum 3 (Field 20) and stops at its offer.

## Protocol

`Buyout` and `BuyMuseum` strictObject schemas (just `turn`).

## Web

- `OfferPanel` in `screens/Game.tsx`: title "Buy out {field}" for a Buyout, else Buy/Build; buttons "Level N · price", "Buy · price" (Museum), "Buy out · price", "Decline". Toast cases `MuseumBought`, `BoughtOut`. Messages `offer_buyout_title`, `offer_buyout`, `offer_museum`, `event_museum_bought`, `event_bought_out` (en/hu/de).
- E2E: `test-hooks.ts` `ViewSummary.phase` has `museum?`/`buyout?`. `two-guests.spec.ts` buys the first Level offer, takes the first Museum offer, declines the rest (checks the "Buy out ·" button when a Buyout shows up).
- Manually verified with a temporarily pinned seed `[-211711500, -1798396580, -1415842072, -619972136]` (2 Players): p1 rolls onto Museum 1 (Field 4) → buy; p2 lands on an unowned University → Level 1; p1 lands on p2's Chicago → Buyout 640,000. Useful for #45 if a seed seam ever exists.
