# Ticket #234 (the Wealth series): what changed and what to watch

Branch `agent/issue-234-rules-record-a-wealth-sample-per-passed-turn-and-a`.
The engine now records every Player's Wealth over the game; nothing reaches a
client yet. Spec #177 (the end-of-game summary); #236 exposes the series.

## The state (version 9)

- `packages/rules/src/state.ts`: `WealthSample = { minute; wealth }`, where
  `wealth` is a `Record<PlayerId, number>` keyed by Player id, and
  `GameState.wealthSamples: WealthSample[]`; `STATE_VERSION` is now 9. The
  same bump adds `GameState.minuteMs`, because the Minute could not be derived
  from `endsAt` and `settings.minuteLimit` alone: `endsAt` is the start plus
  the Room's Minutes, so the start needs the length of one Minute, and the
  server shortens it for e2e runs (`setupGame({ minuteMs })`). `setup.ts`
  stores the option, and `migrate.ts` `MIGRATIONS[8]` gives an old state
  `minuteMs: MINUTE_MS` and `wealthSamples: []`.
- A Bankrupt Player is not special-cased: they hold no cash and no Field, so
  `wealthOf` returns 0 and their series falls to zero at the Bankruptcy and
  stays there.
- `view.ts` lists `minuteMs` and `wealthSamples` in `PublicView`'s `Omit`, so
  neither leaks into a push. #236 must add `summary` with the series; it may
  read `state.wealthSamples` in `publicView` directly.

## The rule module

- `packages/rules/src/rules/wealth-samples.ts`: `recordWealthSample(tx)`
  appends one sample with every Player's `wealthOf` (R77), at the Minute
  `floor((ctx.now − start) / minuteMs)`, `start = endsAt − minuteLimit ×
  minuteMs`; Minutes are 0-based. Pure: it reads only `tx.state` and
  `tx.ctx.now` (ADR-0003), and imports `pricing.ts` only.
- `rules/pass-turn.ts` calls it right after `checkGameEnd` returns `false`,
  so a game-ending Turn records no pass sample.
- `rules/game-end.ts` `finish` calls it after `setFinalPhase` and before the
  `GameEnded` emit, so the last sample is exactly the Wealth `standingsOf`
  reports. Do not add a second call in `passTurn`: it returns early when
  `checkGameEnd` ends the game, and that is the only double-sample guard.

## Tests

- `test/wealth-samples.test.ts`: a passed Turn appends one sample equal to the
  view's Wealth; the Minute from the state clock and from a shortened Minute;
  a Bankrupt Player's series falling to 0; the last sample of a real game
  equal to `standings`; one sample per `TurnPassed` plus one; the two fields
  absent from `publicView`.
- `test/invariants.test.ts`: over `playRandomGame`, Minutes are non-decreasing
  and every Player appears in every sample; samples = passed Turns + 1, and
  the last sample's Wealth equals the final standings.
- `test/migrate.test.ts` now compares the current snapshot's shape with
  `playTurn(newGame()).state`, not `roll(newGame()).state`: the series grows
  with the game, so an empty and a one-sample series have different shapes. A
  v8 state loads with `wealthSamples: []`, then plays on to its end and its
  final sample matches the standings. Fixture `test/fixtures/state-v9.json` is
  `playTurn(newGame()).state`.

Read for: #236 (the view's `summary` and the chart's series), #237, #238, any
state-shape bump, `passTurn` or `finish` touch.
