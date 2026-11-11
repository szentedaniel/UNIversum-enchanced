# Ticket 190 (Chance cards: Exam period, Scholarship transfer): facts for later tickets

Branch `agent/issue-190-chance-cards-exam-period-and-scholarship-transfer`,
spec #174. Additive only: no event type, phase, `STATE_VERSION`, protocol or
client-component change.

## Rules (`packages/rules`)

- `board.ts`: `CHANCE_CARDS` grew from five to seven by appending
  `"examPeriod"` and `"scholarshipTransfer"` after #189's cards (v1's three
  first, then the university cards in merge order; #191 appends its own after
  these). `QUARANTINE_FIELD: FieldId = 8` sits beside `START_FIELD`.
  `CHANCE_CARD_MONEY` gained `examPeriod: 0` and `scholarshipTransfer: 0`: the
  movement cards have no fixed amount, because the Round bonus is a Room
  setting.
- `rules/chance.ts`: `EFFECTS` stays exhaustive; a private `stepsTo(tx,
  playerId, field)` returns the forward distance round the ring. Both cards
  move the drawer with an existing `Moved` event, so the Board's Playback walks
  the token:
  - Exam period calls `moveForwardWithoutRoundBonus` to `QUARANTINE_FIELD`,
    then `enterQuarantine`. From every Chance Field the forward walk crosses
    Start (26 steps from Chance 1) but pays nothing; the event order after
    `CardDrawn` is `Moved`, `QuarantineEntered`, `TurnPassed`, and the usual
    R40/R41 rules then apply (a held PCR test is offered at the next Turn).
  - Scholarship transfer calls `moveForward` to `START_FIELD`, so the
    `RoundBonusPaid` event and the cash are the same payment as passing Start.
    #186's handoff requires this path: `moveForward` reads
    `state.settings.roundBonus` once that setting lands, so a non-default Room
    pays its own value. Never read `ROUND_BONUS` here.
- `rules/movement.ts`: `moveForwardWithoutRoundBonus` is the new sibling of
  `moveForward`; it emits only `Moved` and sets the position. Keep the bonus
  out of it: Exam period is the one walk that must not pay for crossing Start.
- `test/chance.test.ts`: the deck test names all seven ids; the two
  uniformity tests now assume seven cards (first draw 900 samples, 97–160
  each; after a known card 600 samples, 80–120 each). New tests: Exam period
  lands on Field 8 with 3 rounds, unchanged cash and no `RoundBonusPaid`;
  a held PCR test is offered on the Player's next quarantined Turn;
  Scholarship transfer emits `Moved` to Start plus the default
  `RoundBonusPaid` `ROUND_BONUS` amount. `seedDrawing(card)` needed no change.
- No `STATE_VERSION` bump: no `GameState` key changed, and every stored
  `lastChanceCard` value stays a valid `ChanceCardId`.

## Web (`apps/web`)

- `src/text.ts`: `CHANCE_CARD_TEXTS` gained `examPeriod` and
  `scholarshipTransfer`; both read their message with no arguments (no
  `{amount}`). The overlay (`ChanceCardOverlay`) is unchanged.
- Messages: `chance_exam_period_title|text` and
  `chance_scholarship_transfer_title|text` in `messages/{hu,en,de}.json`. Agreed
  titles: hu Vizsgaidőszak / Ösztöndíj-átutalás, en Exam period / Scholarship
  transfer, de Prüfungszeit / Stipendiumsüberweisung. Regenerate Paraglide
  after a message edit with `pnpm --filter @universum/web run paraglide`.
- `test/chance-text.test.ts`: every card still has a non-empty title and text
  in hu, en and de; the agreed titles are pinned; both movement texts name
  Quarantine/the Start Field and the Round bonus in every language. No e2e
  spec changed (the existing `showChance` helper accepts any `ChanceCardId`).
