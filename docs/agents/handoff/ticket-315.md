# Ticket #315 (Rules: FieldView carries the Level Rent table, base price and Doubler count) — facts for later tickets

Branch `agent/issue-315-rules-fieldview-carries-the-level-rent-table-base`. The view keys the Field card (#316) and the hover tooltip (#318) read. Spec #181.

## `packages/rules/src/reveal.ts`

- `FieldView` gained three keys, filled by `revealOf` for every Field, so a reveal and the final view carry the same numbers (ADR-0005):
  - `levelRents: number[]` — a University's Rent at Levels 1–4, `[0]` being Level 1. ×1.4 when the Field's current owner holds the whole Group (`isMonopoly`), the plain Level Rents otherwise and while nobody owns it. The Doubler never multiplies the table. `[]` for a Museum, Chance, Tax and every corner (R25).
  - `basePrice: number` — what the Bank charges while the Field is unowned: a University's **Level 1** Value (its base B, R26), a Museum's `MUSEUM_VALUE` 400,000 (R53), 0 for a Field nobody can own. It stays the same once the Field is owned.
  - `doublers: number` — `state.doubler.count` when the Doubler stands on this Field, else 0 (R61, F10).
- Key names are fixed as the ticket spells them (`levelRents`, `basePrice`, `doublers`); #316 and #318 read these names. No index export changed: `FieldView` was already exported and the new keys ride in it.
- `revealOf` owns its arrays: `levelRentsOf` builds a fresh table on every call, so each reveal (and the final view) has its own. A test pins that two reveals and the view never share one array; do not cache the table in module scope.

## `packages/rules/src/rules/pricing.ts`

- `levelRentsOf(state, field)` builds the table; `basePriceOf(field)` is the unowned price. Both are engine-internal (not in `src/index.ts`); the view carries their output, so the web app needs no import.
- The two new private helpers are the shared code path the ticket asks for: `levelBaseRent(value, level)` is the R28 formula (`round(value × rate / 100)`) and `rentFrom(base, info, monopoly, count)` is the Monopoly/Doubler/Museum rule. `baseRentOf` and `rentWithCount` now call them too, so the table cannot drift from `rentOf`: a row equals `rentOf` for a Field at that Level when no Doubler stands on it (the property test in `universities.test.ts` walks all 20 Universities × Levels 1–4, with and without a Monopoly).
- Rounding order matters and is unchanged: the Level's base Rent is rounded first, then ×1.4 is rounded (`Math.round(base × 14 / 10)`). Restating the multiplier in one expression drifts the table from `rent` by a forint.
- **`rentOf` is still 0 on an unowned Field while the table is non-zero.** That is deliberate: `rent` is what a Player pays now, the table is what the card shows. Do not "fix" the unowned branch of `baseRentOf` to match.
- The ticket's "Level 0 Value" phrase: `board.ts`'s `values[0]` is 0 for a University (R27, "Level 0 is worth 0"), so the unowned price is `values[1]`, the Level 1 Value, which `valueAt(field, 1)` reads. A Museum has `values: null`; `basePriceOf` returns `MUSEUM_VALUE` for it.

## State, protocol, server

- No `GameState` change: `STATE_VERSION` stays 10, there is no new migration step and no `state-v<N>.json` was touched or added. The keys live only in `Reveal`/`PublicView`.
- `packages/protocol` needed nothing: `GameMessage.view` is a type over `PublicView` and `reveals` carries `Reveal`; there is no runtime schema over the view's Field shape.

## Web

- `apps/web/src/playback/playback.ts`: `sameField` (the reveal-dedup behind ADR-0005's "a step whose board is unchanged reuses the previous view object") now also compares `basePrice`, `doublers` and the `levelRents` rows. Without it a step whose table changed but whose `rent` did not — the Doubler on the Field makes `rent` skip the Monopoly (R61) — would keep the previous step's table. `apps/web/test/playback.test.ts` pins it ("a Field whose Level table changed is a changed board").
- Fixtures that build a `FieldView` by hand gained the keys: `apps/web/test/playback-fixtures.ts` (`fieldOf`), `field-facts.test.ts`, `pick.test.ts`, `sale-pick.test.ts`, `checklist.test.ts`. No web behaviour or message changed; the card and the tooltip read the keys in #316/#318.
- The e2e fake views (`apps/e2e/tests/helpers.ts` `showPick`, `pick-tray.spec.ts`, `sale-tray.spec.ts`, `podium.spec.ts`) carry `levelRents: []`, `basePrice: 0`, `doublers: 0` as placeholders, in line with their existing `value: 0` placeholders. #316/#318 should fill real tables where a spec asserts the card's rows.
- The import fence is untouched: the web still imports only rules types and `board`/`playback`; the table is not recomputable there.

## Tests

- `packages/rules/test/universities.test.ts`, describe "the Level Rent table in the view": plain table, Monopoly ×1.4, unowned table, empty for non-Universities, the property test, `basePrice`. The existing `R30` view test now asserts the full 8-key Field.
- `packages/rules/test/museums.test.ts`: no table, `basePrice` 400,000 owned or not, Rent still per Museum owned.
- `packages/rules/test/doubler.test.ts`, describe "the Doubler in the Field view": `doublers` 2 on the Field, `rent` ×3, table plain.
- `packages/rules/test/reveals.test.ts`: a reveal's three keys equal the public view's and are its own arrays; the bankruptcy beat's Field assertion carries them.
