# Ticket #192 (Deal engine: propose, accept and decline) — extension points and gotchas

Branch `agent/issue-192-deal-engine-propose-accept-and-decline`, from `main`. Spec #172.

## State and migration

- `GameState.deal: Deal | null` holds the pending Deal (`DealSide` = `{ fields, cash }`),
  `null` outside one. `STATE_VERSION` is 3; `MIGRATIONS[2]` adds `deal: null`, and
  `test/fixtures/state-v3.json` is the committed snapshot.
- `publicView` carries `deal` (and the `phase`), so a client sees the proposal and whose
  answer is pending. `setupGame` starts with `deal: null`.

## The answer is the recipient's Decision

- `rules/deal.ts` declares the `dealAnswer` phase and `ProposeDeal` / `AcceptDeal` /
  `DeclineDeal`. **While a Deal is pending the recipient is `state.currentPlayer`** — that
  is how the existing actor gate lets them answer, why `TurnTimedOut` names them, and why
  the Turn ring moves to their Player card. The proposer's own Roll or Quarantine choice is
  not stored: `reopenProposer` clears `deal`, restores `currentPlayer` and calls
  `beginTurn`, so the reopened `quarantineChoice` recomputes `canBuyPcrTest` from the
  post-Deal cash. Do not store the suspended phase.
- `apply` fixes the deadline after every answer (accept, decline, expiry), so the proposer
  gets a fresh Turn timer (ADR-0004) automatically.
- `dealProblem(tx, deal)` is the one validation: recipient is another active Player, every
  offered Field the proposer's and every asked Field the recipient's, no Field twice, at
  least one item, cash covered both ways. It runs at the proposal **and** at the
  acceptance (the #193 re-check).
- `dealAnswerTimeout` is wired into `TIMEOUT_OUTCOMES` in `rules/timeout.ts`: the Deal
  counts as declined with no Timeout penalty, and the proposer's decision reopens.

## Effects, events, Playback

- `AcceptDeal` moves Field ownership only (Level and the Doubler stay), then moves the cash
  between the two Players (`DealAccepted`'s cash never touches the Bank).
- Events: `DealProposed` / `DealAccepted` (both carry the full `Deal` terms),
  `DealDeclined` / `DealExpired` (`{ proposer, recipient }`). `PLAYBACK_MS` gives each
  `BEAT_MS`; `apps/web/src/playback/presentation.ts` has one toast row per event
  (`DealProposed` notice, the rest routine), with `sideText` rendering each side's Fields
  and cash and `deal_nothing` for an empty side. Messages are `event_deal_*`, `deal_nothing`
  and `rejection_deal_*` in hu/en/de.
- `test/simulation.ts`'s `ledgerOf` accounts `DealAccepted` as a Player-to-Player cash move,
  and `nextMove` answers a `dealAnswer` with accept or decline.

## Protocol and Rejections

- `packages/protocol/src/schemas.ts` has `dealSide` and `playerId` plus the three schemas;
  the compile-time `PlayerIntentsMatchRules` check keeps them in step with the rules.
- New rules Rejection codes: `DEAL_RECIPIENT_INVALID`, `DEAL_FIELD_NOT_OWNED`,
  `DEAL_FIELD_REPEATED`, `DEAL_EMPTY`, `DEAL_CASH_NOT_COVERED` (listed in
  `RULES_REJECTION_CODES`, `REJECTION_CODES` and the web's `REJECTIONS` map).

## What is left to later tickets

- **#193**: the one-Deal-per-Turn guard and its state/flag (the acceptance re-check and the
  timeout expiry already work here).
- **#194**: the composer and the answer panel. `openDecision` returns `null` for
  `dealAnswer` (`apps/web/src/decision/decision.ts`), so the recipient currently sees no
  controls; `apps/e2e/tests/helpers.ts`'s `resolveDecision` throws on that phase.
- **#200**: `apps/loadtest/src/bot.ts`'s `offeredIntents` falls through to `[]` for
  `dealAnswer`, so a Bot never answers a Deal yet.

## Tests

- `packages/rules/test/deal.test.ts` (15 tests) drives `apply`/`publicView` only: proposal
  validation, accept (Level, Doubler, cash, the ledger), decline, the recipient-only answer,
  the Quarantine resume with recomputed options, the fresh deadline, expiry and the
  per-event reveals.
- `packages/protocol/test/schemas.test.ts` pins the three schemas; `apps/web/test/presentation.test.ts`
  pins the Deal rows and tones.

Read for: #193 #194 #200, any Deal rule, Deal event or Deal message, any `dealAnswer` phase
handling, the state version 3 migration.
