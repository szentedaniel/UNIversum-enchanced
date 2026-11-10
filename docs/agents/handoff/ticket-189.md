# Ticket #189 (Chance cards: Textbook fair, Teaching assistant job): facts for later tickets

Branch `agent/issue-189-chance-cards-textbook-fair-and-teaching-assistant`,
spec #174. Additive only: no event type, phase, `STATE_VERSION`, protocol or
client-component change.

## Rules (`packages/rules`)

- `board.ts`: `CHANCE_CARDS` grew to
  `["pcrTest", "scholarship", "failedExams", "textbookFair", "teachingAssistantJob"]`
  (v1's three first, new ids appended), and `CHANCE_CARD_MONEY` gained
  `textbookFair: -150_000` and `teachingAssistantJob: 300_000`. Sibling tickets
  #190/#191 append their cards to the same array and record: keep the v1 three
  first and append, so the order is merge order for the new cards.
- `rules/chance.ts`: `EFFECTS` is exhaustive over `ChanceCardId`; two private
  helpers carry the money effects — `bankPays(tx, player, amount)` (credits cash
  and emits `ChanceMoneyReceived`) and `bankCharges(tx, player, amount)`
  (`charge(tx, player, { kind: "chanceCard", amount })`). Scholarship and
  Teaching assistant job call `bankPays`; Failed exams and Textbook fair call
  `bankCharges` with `-CHANCE_CARD_MONEY.<id>`. The draw rule is untouched:
  uniform over `CHANCE_CARDS` minus `lastChanceCard`.
- `test/chance.test.ts`: the deck test now names all five cards, and the two
  uniformity tests assume 5 cards (first draw 900 samples, 144–216 each; after
  a known card 600 samples, 120–180 each). `seedDrawing(card)` searches the
  fixed mixed-seed series for a seed whose first draw is that card, so it needed
  no change. `draw(seed, last, start)` forces the `lastChanceCard` and the
  starting cash/Fields.
- Textbook fair's Charge is pinned through the apply seam: cash-only pays
  150,000; cash 50,000 + Veszprém (sale 180,000) opens
  `selling { shortfall: 100_000, resume: { kind: "chanceCard", amount: 150_000 } }`;
  cash 50,000 alone pays 50,000 and goes `WentBankrupt`.
- No `STATE_VERSION` bump: no `GameState` key changed, and every stored
  `lastChanceCard` value stays a valid `ChanceCardId`.

## Web (`apps/web`)

- `src/text.ts`: `CHANCE_CARD_TEXTS` is exhaustive over `ChanceCardId` (a new
  card fails `tsc` until it has a title and text). Both texts pass
  `formatMoney(-CHANCE_CARD_MONEY.textbookFair)` / `formatMoney(CHANCE_CARD_MONEY.teachingAssistantJob)`,
  so the amount follows the active language's number format.
- Messages: `chance_textbook_fair_title|text` and
  `chance_teaching_assistant_job_title|text` in `messages/{hu,en,de}.json`
  (hu: Tankönyvvásár, Demonstrátori állás; de: Bücherbasar, Tutorstelle).
  Regenerate Paraglide after a message edit with
  `pnpm --filter @universum/web run paraglide`.
- `test/chance-text.test.ts`: every card has a non-empty title and text in hu,
  en and de; both new texts contain their amount in every language; the agreed
  en/hu titles are pinned. The overlay (`ChanceCardOverlay`) is unchanged and
  reads `chanceCardText(card)`; no e2e spec was changed.
