# Ticket #28 (Chance cards / Tax): facts for later tickets

Branch `ticket/28-chance-tax`.

## Rules (`packages/rules`)

- **Board data** (`board.ts`, web may import): `CHANCE_CARDS = ["pcrTest", "scholarship", "failedExams"]` (v1 order 0/1/2), `ChanceCardId`, `CHANCE_CARD_MONEY` (0 / +200,000 / −200,000).
- `GameState.lastChanceCard: ChanceCardId | null` (null at setup, F17), in `publicView` too. **STATE_VERSION not bumped**; regenerated #34's `test/fixtures/state-v1.json` instead (nothing deployed).
- `rules/chance.ts`: `landOnChance` = the `chance` entry in `LANDINGS`. Draw = `randomInt` over the cards other than `lastChanceCard` (uniform; first draw over all 3). Events `CardDrawn {player, card}`, then the effect: `ChanceMoneyReceived {player, amount}` (Bank pays), `ChanceChargePaid {player, amount}` (via `charge`, so **#29's solvency rule covers it automatically**; `amount` = what was actually paid), PCR card sets `hasPcrTest = true` (no extra event; a second one is wasted, F23).
- `rules/tax.ts`: `landOnTax` (the `tax` entry). `TaxPaid {player, amount}` via `charge`, emitted even when the amount is 0. Amount computed once at landing = round(10% × `fieldsValue`).
- **`fieldsValue(state, player)`** (exported from `rules/tax.ts`): Universities at `valueOf`, every Museum at `MUSEUM_VALUE` (400,000, `constants.ts`) whoever owns it (F2). **#32 Wealth = cash + fieldsValue** — reuse it (or move it into `pricing.ts`). #27 can use `MUSEUM_VALUE` as the Museum price/Value.
- Neither landing decides: the Turn passes right after (R33/R37: no ack intent).
- Tests: `test/chance.test.ts` (seeded draws via a `mix`-hashed seed series; `seedDrawing(card)` finds a seed whose first draw is that card; draws on Field 14 via `rollOnto` with `lastChanceCard` patched), `test/tax.test.ts` (Field 30).

## Web

- `text.ts` `chanceCardText(card)` → `{ title, text }` (amounts from `CHANCE_CARD_MONEY`). Messages `chance_{pcr_test,scholarship,failed_exams}_{title,text}`, `event_card_drawn`, `event_chance_money_received`, `event_chance_charge_paid`, `event_tax_paid` (hu/en/de).
- `Game.tsx` `describe()` cases for the four events; `CardDrawn` and `TaxPaid` are in #30's `NOTICES` set, so they take the toast ahead of `DiceRolled`.
- No e2e: server seeds are random, so a Chance/Tax landing can't be forced in Playwright (same as #30).
