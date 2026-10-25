# Ticket #82 (effects before their events): extension points and gotchas

Branch `ticket/82-bankruptcy-beats` (on `per-event-reveals`), spec #79,
ADR-0005. Rules package only: `rules/charge.ts` and two rules tests. No event
payload, event type, `STATE_VERSION` or client change.

## Bankruptcy in two beats

`goBankrupt` computes `raised` (cash plus the sale value of every Field) and
`fields` **before anything moves**, then takes the payer's cash to 0, credits
the payee and emits the Charge event (`RentPaid`, `TaxPaid`,
`ChanceChargePaid`, `TimeoutPenaltyPaid`), and only then returns the Fields to
the Bank, sets `bankrupt` and emits `WentBankrupt` (adjacent events).

- The Charge's reveal shows the payer at 0 cash, the payee credited with
  `raised`, the Fields still owned (Level and Doubler intact) and the Player
  not yet Bankrupt. `WentBankrupt`'s reveal — the next event — shows them
  unowned, Level 0 and without the Doubler, with the Player Bankrupt.
- Amounts, event order and the final state are unchanged (F12): a Rent still
  pays the owner exactly what the payer could raise. `test/simulation.ts`'s
  `ledgerOf` reads the event list and the pre-Charge cash, not the state, so
  the reorder left it untouched.
- A test or spec that reads a bankruptcy's board must pick its event index:
  `packages/rules/test/reveals.test.ts` (`R70, R71: …`) pins both beats.

## The ordering audit (every `emit` in `rules/`)

Rule code applies its effect, then emits; a change shows with the first event
emitted after it (ADR-0005). `goBankrupt` was the only offender and is
reordered. Verified apply-first, area by area:

| Emit                                                                                  | Effect applied before                                                                  |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `RentPaid`, `TaxPaid`, `ChanceChargePaid`, `TimeoutPenaltyPaid` (`charge.ts` `payTo`) | payer's cash taken in `payFromCash`/`goBankrupt`, payee credited in `payTo`            |
| `FieldsSold` (`sellFields`)                                                           | Fields returned to the Bank, cash credited                                             |
| `WentBankrupt`                                                                        | Fields returned, `bankrupt` set                                                        |
| `Moved`, `RoundBonusPaid` (`movement.ts`)                                             | position, then cash                                                                    |
| `DiceRolled` (`turn.ts`, `quarantine-choice.ts`)                                      | dice drawn from the PRNG; no other state                                               |
| `CardDrawn` (`chance.ts`)                                                             | **deliberately before** the card's effect: the card shows, then its effect (see below) |
| `ChanceMoneyReceived`                                                                 | cash credited                                                                          |
| `LevelBought`, `BoughtOut` (`universities.ts`)                                        | cash both ways, Field owner                                                            |
| `OfferDeclined`                                                                       | no effect                                                                              |
| `MuseumBought` (`museums.ts`)                                                         | cash, Field owner                                                                      |
| `DoublerPlaced` (`doubler.ts`)                                                        | `doubler`                                                                              |
| `QuarantineEntered`, `QuarantineReleased` (`quarantine.ts`)                           | `quarantineRounds`                                                                     |
| `PcrTestBought`, `PcrTestUsed`, `QuarantineRoundUsed`                                 | cash, `hasPcrTest`, `quarantineRounds`                                                 |
| `TurnPassed` (`pass-turn.ts`)                                                         | `currentPlayer`, `turn`                                                                |
| `TimedOut` (`timeout.ts`)                                                             | no effect of its own; the penalty's own event follows it                               |
| `GameEnded` (`game-end.ts`)                                                           | `currentPlayer` and the final phase (neither is in a reveal)                           |

- `passTurn` runs `beginTurn` **after** `TurnPassed`; a release there emits its
  own `QuarantineReleased` and a `setPhase` is never revealed, so nothing is
  applied late. `reveals.test.ts`'s snapshot test pins this.
- `CardDrawn` must stay before `EFFECTS[card]`: a scholarship's
  `ChanceMoneyReceived` then follows the card, and the card never shows its
  effect before it is shown. The PCR test has no event of its own, so it shows
  with the next event's reveal (the Turn passing) and in the final view — never
  in the `CardDrawn` reveal. `chance.test.ts` (`R35, ADR-0005: …`) pins it; do
  not add an event for it (spec #79, out of scope).

## Verified on this branch

`pnpm install --frozen-lockfile`, `check:commits`, `oxfmt --check`, `lint`,
`-r typecheck`, the whole vitest run (974), the `TEST_HOOKS=1` web build, the
full e2e suite on 3182/5282 and `docker compose build`.
