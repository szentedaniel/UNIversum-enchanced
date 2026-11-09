# Ticket #122 (e2e `resolveDecision` is total) — what changed and gotchas

Branch `agent/issue-122-e2e-resolvedecision-include-the-roll-and-roll-for`
(on `main`), architecture issue #122. Test code only: the shared e2e helper and
the two specs that used to wrap it. No app, rules or protocol change.

## `resolveDecision` (`apps/e2e/tests/helpers.ts`)

- **Every phase kind now resolves here.** `awaitingRoll` presses `Roll`,
  `quarantineChoice` presses `Roll for 12`, `gameOver` throws. The first two
  return `{ kind: "roll" }`; `DecisionResult` gained that variant and lost
  `null`, so a caller never has to ask "did the helper handle this view?".
- **The switch is exhaustive.** Its `default` assigns `phase` to `never`, so a
  new phase kind declared through `PhaseMap` declaration merging fails
  `tsc` here until it gets a case. This replaces the old `return null`
  fallback noted by ticket-71: a phase that needs no control still needs an
  explicit result kind.
- **`chooseOffer` is only called for `offer`.** The Roll and Quarantine cases
  ignore it, as the pick and Sale cases already did.
- **The Roll's Playback still gates the press.** `press` waits for the button
  to be enabled, and every control appears only once the Playback ends
  (ADR-0004), so no extra wait is needed.

## The specs

- `full-game.spec.ts` `playDecision` is now the helper plus its `past(version)`
  wait and the mapping to `"buy"`/`"pick"` (`roll`, `decline` and a Buyout's
  `buy` fold in as before; `takeOffer` never buys out). Its own game-over
  check is gone: the helper throws, and the main loop breaks on `gameOver`
  before calling it.
- `two-guests.spec.ts`'s local wrapper keeps only the `offer` waiter-side
  assertions and the `bought`/`museum` bookkeeping. It calls the shared helper
  for every phase; it no longer switches on `quarantineChoice`.
- **Keep the per-Turn loop guard.** `playTurn` breaks when the phase is
  `awaitingRoll` or `gameOver`, because the Roll that ended the Turn was
  already pressed outside the loop; resolving an `awaitingRoll` inside it would
  play the next Turn. The wrapper is total, the Turn loop is not a decision
  chain.
- A Quarantine roll can still stop at an `offer` on a 12; the same per-Turn
  loop resolves it, and `takeOffer` sees the unchanged `bought`/`museum`.
