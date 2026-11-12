# Ticket 191 (Chance cards: Dorm party, Thesis printing): facts for later tickets

Branch `agent/issue-191-chance-cards-dorm-party-and-thesis-printing`,
spec #174. The last ticket of the six university cards.

## Rules (`packages/rules`)

- `board.ts`: `CHANCE_CARDS` grew to nine by appending `"dormParty"` and
  `"thesisPrinting"` after #190's cards; the deck is now
  `pcrTest, scholarship, failedExams, textbookFair, teachingAssistantJob,
  examPeriod, scholarshipTransfer, dormParty, thesisPrinting`. `CHANCE_CARD_MONEY`
  holds one payment's amount, not the drawer's total: `dormParty: 50_000` and
  `thesisPrinting: -50_000`. The sign is the drawer's direction, so the web
  text formats `CHANCE_CARD_MONEY.dormParty` and
  `-CHANCE_CARD_MONEY.thesisPrinting`.
- `rules/chance-transfer.ts` (new) owns the Player-to-Player payment batch and
  the one new event, `ChanceTransferPaid { player, payee, amount }`. Its
  `payTransfers(tx, actor, payments)` charges each payment in list order,
  skipping a Player who is already Bankrupt, and returns `true` when all were
  made (it has put `actor` back as `currentPlayer`); `false` when a Sale opened
  and the rest waits. `resumeTransfers(tx, pending)` is the same call from the
  Sale's `chanceTransfer` Charge.
- `rules/chance.ts`: the two effects build their payments from the other
  non-Bankrupt Players in Seat order (`othersOf`): Dorm party as
  `payer → drawer`, Thesis printing as `drawer → payee`. There is no new phase
  and no new intent.
- `rules/charge.ts`: `PendingCharge` gained
  `{ kind: "chanceTransfer"; amount; payee; actor; rest }`, where `actor` is the
  card's drawer and `rest` the payments still to make. `payTo` credits the
  payee and emits `ChanceTransferPaid`; a Bankrupt payer's event reports what
  they could raise, exactly as `RentPaid` does. The continuation rides in the
  Sale's `resume`, so **no new `GameState` key and no `STATE_VERSION` bump**
  (old stored states never hold the new variant).
- A payment the payer cannot cover with cash opens `selling` with the payer as
  `currentPlayer` (the Deal answer's precedent): the payer sells or Auto-sells
  their own Fields, `saleOf`/`view.autoSell`/the bot policy need no change.
  After the Sale, `sale.ts`'s `afterCharge` calls `resumeTransfers`; another
  short payer opens the next Sale, and only when every payment is made does
  `passTurn` run — from the drawer, not from the payer.
- `timeout.ts`: a `chanceTransfer` Sale that times out is Auto-sold and the
  card carries on, with **no Timeout penalty** and no Buyout; the payer's timer
  is a forced sub-decision, as the Deal answer's is. Every other Sale keeps
  R69's penalty.
- `playback.ts`: `ChanceTransferPaid: BEAT_MS`, so the three payments of a
  4-Player card are three steps after the 7 s card.
- `test/chance.test.ts`: the deck test names all nine cards; the uniformity
  tests now sample 1,800 first draws (160–240 each) and 1,200 after a known
  card (120–180 each). New tests pin each card's events, cash and per-payment
  reveals; a short payer's `SellFields`, Auto-sell, chained second Sale,
  bankruptcy, and timed-out Sale; a short drawer's Auto-sell and bankruptcy
  (the remaining payees get nothing once the drawer is Bankrupt).
  `test/simulation.ts`'s ledger treats `ChanceTransferPaid` like `RentPaid`
  (player to player, the Bank covers a Bankrupt payer's shortfall).

## Web (`apps/web`)

- `src/text.ts`: `CHANCE_CARD_TEXTS` is exhaustive over the nine ids; the two
  new entries pass the payment amount through `formatMoney`.
- Messages: `chance_dorm_party_title|text` and
  `chance_thesis_printing_title|text` (hu Kolibuli / Szakdolgozat-nyomtatás,
  en Dorm party / Thesis printing, de Wohnheimparty / Druck der
  Abschlussarbeit), and `event_chance_transfer_paid` with `{name} {amount}
  {payee}`. Regenerate Paraglide after a message edit with
  `pnpm --filter @universum/web run paraglide`.
- `src/playback/presentation.ts`: `ChanceTransferPaid` is a `toast` with the
  `notice` tone and its line names payer, amount and payee. The Sale tray
  reuses `sale_charge_chance_card` for the new `chanceTransfer` kind
  (`DecisionTray`'s `CHARGE_LABELS`).
- `test/chance-text.test.ts` pins the agreed titles and that both texts name
  the amount and "every other Player" in every language;
  `test/presentation.test.ts` pins the new event's overlay and tone.
- `apps/e2e/tests/helpers.ts` `ROLL_PLAYBACK_MS` and `full-game.spec.ts`
  `FINAL_PLAYBACK_MS` now include three `ChanceTransferPaid` events, so the
  waits stay the longest a push can carry.
