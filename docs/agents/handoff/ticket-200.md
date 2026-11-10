# Ticket #200 (Bots answer Deals) — extension points and gotchas

Branch `agent/issue-200-bots-answer-deals`, from main at `9f1bc31`.

## The policy

- `botIntent`'s `dealAnswer` case calls `dealIntent(view)` in
  `packages/rules/src/bot.ts`. It reads `view.deal` (the pending terms) and
  answers `AcceptDeal`/`DeclineDeal`; it never returns `ProposeDeal`.
- Valuation: a side is worth each Field's `FieldView.value` plus
  `FieldView.rent`, plus its cash at face value. The Bot accepts when
  `incoming * 10 >= outgoing * DEAL_AHEAD_TENTHS` (`11`, at least a tenth
  ahead) and every Field it gives away (`deal.take.fields`) is outside a Group
  it owns every University of. A gift is accepted; a demand is declined.
- `breaksMonopoly` uses static `FIELDS` group membership and `view.fields`
  ownership. A Museum has `group: null`, so it never trips the guard.
- `view.deal` is non-null in `dealAnswer`; the policy throws on a view that
  violates that invariant. Rent is priced as the view shows it, so an incoming
  Field of the proposer's Monopoly carries the proposer's multiplier; the 10%
  margin absorbs that approximation.

## Simulation and load test

- `playBotGame({ dealEvery })` in `packages/rules/test/simulation.ts` has the
  driver stand in for a Guest proposer: on every `dealEvery`-th Turn it puts a
  gift (even Turn) or a demand (odd Turn) to the next active Player, then the
  Bot answers through `botIntent`. `dealTurn` keeps it to one Deal per Turn, so
  the reopened Roll or Quarantine decision cannot propose again. `dealEvery: 0`
  (the default) keeps the old policy-only game.
- `packages/rules/test/bot.test.ts` has a `Deal answer` describe (cash
  boundary, Field Value plus Rent, the Monopoly guard) and the property test
  passes `dealEvery: 1`, asserting a Bot answered at least one Deal.
- `apps/loadtest/src/bot.ts`'s `offeredIntents` now offers both `AcceptDeal`
  and `DeclineDeal` for `dealAnswer`; the loadtest Guest still never proposes
  one (no `ProposeDeal` in `offeredIntents`).

## Room server

- No change needed: `GameDriver.#scheduleBot`/`#playBot` already call
  `botIntent(publicView(game, timing))` for whichever Player is current, so a
  Deal proposed to a seated Bot is answered `BOT_DELAY_MS` after the gate.
  #198 (a dropped Guest's Seat) still has to widen the `player.bot === true`
  check; #199 still has to suppress Bot wake-ups with no Guest connected.
