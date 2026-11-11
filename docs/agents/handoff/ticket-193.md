# Ticket #193 (Deal expiry and guards) — extension points and gotchas

Branch `agent/issue-193-deal-expiry-and-guards`, from `main`. Spec #172.

## The per-Turn guard

- `GameState.dealUsed: boolean` records that this Turn's Deal was proposed.
  `ProposeDeal` refuses with `DEAL_ALREADY_PROPOSED` while it is true, before any
  other validation, and sets it only after `dealProblem` passes, so a refused
  proposal does not spend the Turn's Deal.
- `passTurn` clears the flag at the Turn boundary (`rules/pass-turn.ts`).
  `beginTurn` must not clear it: `reopenProposer` calls `beginTurn` inside the
  same Turn after an answer, and the proposer must stay barred from a second
  Deal. If the reset ever moves into `beginTurn`, `reopenProposer` has to put
  the flag back.
- `publicView` carries `dealUsed`; `PublicView` is an `Omit<GameState, …>`, so a
  new state field fails to compile until `publicView` returns it. #194's
  composer can read `dealUsed` to hide or disable the Deal control.

## State version and migration

- `STATE_VERSION` is 7. `MIGRATIONS[5]` (from #186) adds the Round bonus, and
  `MIGRATIONS[6]` adds `dealUsed: state["deal"] !== null`: a stored version-6
  state with a pending Deal has used this Turn's Deal, one without has used
  none (the old rules had no guard). `test/fixtures/state-v7.json` is the
  committed snapshot, generated from `playTurn(newGame()).state`.
- Every hand-built `PublicView` literal needs `dealUsed`:
  `apps/web/test/{checklist,field-facts,pick,sale-pick}.test.ts`,
  `apps/web/test/playback-fixtures.ts` and `apps/loadtest/test/bot.test.ts`.

## Re-check, expiry and Quarantine

- `dealProblem` already ran at both the proposal and the acceptance (#192), so
  `AcceptDeal` refuses `DEAL_FIELD_NOT_OWNED` / `DEAL_CASH_NOT_COVERED` when the
  stored Deal is stale. `test/deal.test.ts` pins both sides of that re-check
  with its two `acceptance refuses a Deal whose …` tests.
- Expiry at the recipient's deadline and proposing from `quarantineChoice` are
  unchanged from #192; the tests `the recipient's timer running out declines
  the Deal with no Timeout penalty` and `only the current Player may propose,
  and only at a Roll or Quarantine choice` cover them.
- The new code is in `RULES_REJECTION_CODES`, protocol `REJECTION_CODES`, the
  web `REJECTIONS` map in `apps/web/src/text.ts`, and the hu/en/de
  `rejection_deal_already_proposed` messages.

## Merged alongside

- #194's composer and answer panel handle `dealAnswer` in `openDecision`; the
  composer and answer panel render from the pushed view. The composer does not
  read `dealUsed` yet, so after a declined Deal the control returns and the
  server refuses the second proposal with `DEAL_ALREADY_PROPOSED`.
- #200's Bot answers a Deal in `rules/bot.ts`, and the loadtest Bot offers
  `AcceptDeal`/`DeclineDeal`; neither proposes a Deal.

Read for: #194 #200, any Deal rule, the per-Turn guard or a `dealUsed` read.
