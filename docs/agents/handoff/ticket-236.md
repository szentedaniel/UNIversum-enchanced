# Ticket #236 — the final Summary in the `PublicView`

Branch `agent/issue-236-rules-expose-the-wealth-series-and-summary-figures`, based on `main`.

## Rules

- **`PublicView.summary: GameSummaryView | null`** (`packages/rules/src/view.ts`): the figures the engine counted (`GameState.summary`, ticket #235) plus the Wealth series (`GameState.wealthSamples`, ticket #234). `publicView` fills it only at `gameOver`, through the private `summaryView`, exactly like `standings`; while the game runs it is `null`.
- **`GameSummaryView = GameSummary & { series: WealthSample[] }`**, exported from `packages/rules/src/index.ts`. `series` is the state's sample list itself: one `{ minute, wealth }` per passed Turn plus the final one `finish` records at `GameEnded`, so its last sample equals `standings`' Wealth for every Player.
- **A game stored before the series yields `series: []`**, not an error: `MIGRATIONS[8]` adds the empty list (a v8 snapshot) and `summaryView` hands it out as-is. A game stored before the counters also has the empty figures (`MIGRATIONS[9]`).
- **The two `summary` names are different shapes.** `GameState.summary` is the four figures only; `PublicView.summary` is those figures plus `series`. Do not spread the state into the view (the view's `Omit` list exists for that reason).
- Tests: `packages/rules/test/summary-view.test.ts` pins null-while-running, the last sample against `standings`, the figures against `summaryOf` for the same game, and the empty series of a v8 final save. `summary.test.ts` now only checks the raw figures stay off the view's top level.

## Server

- `GameRoom.gamePush` builds every push from `publicView`, so a Guest who rejoins an ended Room by Guest token receives the same `summary` as the Guests who watched the end; `apps/server/test/reconnect.test.ts` pins it with the shared `startedGame`/`scheduler.advanceTo` helpers.

## Fixtures and later tickets

- Every full `PublicView` literal needs `summary: null`: `apps/web/test/playback-fixtures.ts` (`BASE_VIEW`) and the local `viewWith` fixtures in `apps/web/test/{checklist,field-facts,pick,sale-pick}.test.ts`, plus `apps/loadtest/test/bot.test.ts`. `apps/e2e/tests/podium.spec.ts` `showGameOver` clones a live push's view, so its `summary` is `null` until #238 sets a made-up one.
- #237 reads `view.summary.series` and the figures; #238 renders them. The result screen must render nothing but the Podium when `view.summary` is `null`.
- The series rides every end-of-game push and the reconnect push after it (spec #177 decision 5); a few hundred samples at most.
