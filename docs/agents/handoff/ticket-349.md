# Ticket #349 (spectator e2e review follow-ups from #348) — the shared e2e steps

Branch `agent/issue-349-factory-review-follow-ups-348`. Three follow-ups to #253's
spectator spec, all in `apps/e2e/tests/`; no production code, no test id and no
`playwright.config.ts` change. CI runs the specs; this branch only typechecks them.

## The shared helpers in `helpers.ts`

- `shownView(page)` returns `window.universumTest?.view() ?? null`: the view the
  client's Board last drew, the Playback's frame while it runs. It replaced three
  local copies: the spectator spec's `shownView`, `two-guests.spec.ts`'s `viewOf`
  and the arrow inside `field-card.spec.ts`'s camera test. `deal.spec.ts` and
  `full-game.spec.ts` keep their own `viewOf`: they read `room().push?.view`
  (the latest push), a different step.
- `expectGate(page, open, timeout)` polls `playback().gateOpen` against `open`.
  A missing hook reads as `null`, which matches neither state, so the poll keeps
  waiting for the Board. That preserves both old defaults at once: `?? true` in
  the spectator's pre-Roll wait (`open: false`) and `?? false` after it
  (`open: true`). Callers: `tapField` (`PLAYBACK_MS.CardDrawn`), the spectator
  spec twice (`ROLL_PLAYBACK_MS`) and `field-card.spec.ts` once (`15_000`, inside
  its `toPass` retry). `first-game-hints.spec.ts`'s two gate polls now use
  `expectGate` too (`ROLL_WAIT_MS` before the hint assertions, and its own
  `RELOAD_GATE_WAIT_MS` — 5 s for the second Board draw — after the reload,
  whose rejoin push carries no events and so has no Playback to budget).
- `ROLL_WAIT_MS` is `ROLL_PLAYBACK_MS + 1_000`: the wait after a Roll's Playback,
  the push's arrival plus the poll's interval. It replaced `two-guests.spec.ts`'s
  local `ROLL_WAIT_MS` and the three inline `ROLL_PLAYBACK_MS + 1_000` timeouts in
  `spectator.spec.ts` (two) and `first-game-hints.spec.ts` (one). Every timeout
  kept its old length.

## The seed assertion

`spectator.spec.ts` now asserts, before `roll.click()`, that the pushed
`joined.currentPlayer` equals the creator page's `room().me`, with a message
naming the assumption: the creator rolls first, and the e2e seed's first Roll
(dice [5, 5]) lands on Field 10's University. The Offer assertions below it lean
on that; the seed itself is unchanged.

## Left in the spec on purpose

The pawn-to-`fieldCenter` distance poll (2 px) stays in `spectator.spec.ts`: it
is its only caller. `background-tab.spec.ts` reads `pawn` and `fieldCenter` once
after a resumed frame, which is a different step, so it was not a second caller.
