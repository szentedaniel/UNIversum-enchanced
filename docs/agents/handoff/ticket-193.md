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

- `STATE_VERSION` is 6. `MIGRATIONS[5]` adds
  `dealUsed: state["deal"] !== null`: a stored version-5 state with a pending
  Deal has used this Turn's Deal, one without has used none (the old rules had
  no guard). `test/fixtures/state-v6.json` is the committed snapshot, generated
  from `playTurn(newGame()).state`.
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

## Still later

- #194 owns the composer and the answer panel: `openDecision` still returns
  `null` for `dealAnswer`.
- #200 owns the loadtest Bot's Deal answer: `offeredIntents` falls through to
  `[]` for `dealAnswer`.

Read for: #194 #200, any Deal rule, the per-Turn guard or a `dealUsed` read.
