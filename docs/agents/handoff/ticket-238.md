# Ticket #238 — the Summary and the Wealth chart on the result screen

Branch `agent/issue-238-web-summary-and-wealthchart-on-the-result-screen-o`, based on `main`. The Podium opens a Summary panel with the engine's four figures and the Wealth chart; nothing here recomputes a number (ADR-0001, ADR-0005).

## `apps/web/src/components/WealthChart.tsx`

- `WealthChart({ series, players })` draws `wealthChart(series, players, SIZE)` from `pick/wealth-chart.ts` (`#237`) in a `360 × 240` SVG: one `polyline` per `ChartPlayer` in `playerLook(seat).color` over an ink underlay (pale colours stay visible on cream), and a `circle` at the final sample.
- Test ids: `wealth-chart` (the figure), `wealth-chart-svg` (the `role="img"` chart), `chart-line` / `chart-marker` (one per Player, `data-player`), `chart-player` (the text alternative's item) and `wealth-chart-empty`.
- The chart's accessible name is `m.summary_chart_label()`; the visible list under it is the text alternative (`m.summary_chart_alt()`), one line per Player with `start` → `end` Wealth from the same `ChartPlayer`.
- Axis ticks are `formatCompactMoney` (y) and `formatCount` (x); the axis labels are drawn inside the geometry's own margins, so a margin change in `pick/wealth-chart.ts` is a deliberate layout change.
- An empty series (a pre-series v8 save) draws no SVG at all: the figure shows `m.summary_chart_empty()` instead, so no empty frame appears.
- `role="img"` on the SVG carries an oxlint block disable (`jsx-a11y/prefer-tag-over-role`) with the reason: an `<img>` cannot hold the lines and markers. Keep the disable if the element moves.

## `apps/web/src/components/Summary.tsx`

- `Summary({ view, onBack })` returns `null` when `view.summary` is null, so the Podium is all the result screen shows before a Summary exists.
- The figures are `summaryView(view.players, view.summary)` (`#237`), rendered in the spec's order with `data-figure="rent|buyer|monopolies|bankruptcies"`: biggest Rent (payer, owner, amount, Field name), top buyer (name, count), Monopolies and Bankruptcies, each with `playerName` and `PlayerToken`.
- `monopolyRows` groups the engine's formations by `player.id:group` and shows a repeated Group as one row with `×count` (`m.summary_monopoly_repeat`). `summaryView` keeps every formation, so the count preserves the glossary's "a Group lost and completed again counts twice"; the grouped key is also what keeps the `<li>` keys stable.
- A Monopoly names its Group's Universities in ring order (`groupUniversities` reads `FIELDS`, `#235`'s `GroupId`) and shows the Group colour from `GROUP_COLORS` (`#board/colors.ts`).
- Test ids: `summary`, `summary-title`, `summary-back` and `summary-monopoly`.

## `apps/web/src/components/Podium.tsx`

- The Summary's open/closed state is local (`useState`); the Podium gate (`shownTurn`, Playback, `#51`) is untouched. `view.summary` is read from the view the Game screen passes in.
- `summary-open` (a `plain` Button) appears only when `view.summary` is non-null; `summary-back` calls the Podium's `onBack`. The Podium's existing test ids (`podium`, `podium-title`, `podium-places`, `podium-place`, `podium-block`, `podium-below`, `rematch-*`) keep their ids and order.
- The result content now lives in a `flex-1 overflow-y-auto` box with `my-auto`, so the SUMMARY scrolls on a short phone; the `Back to the Lobby list` link stays outside that box (`shrink-0`), so it is always on screen — the layout answer to the ticket's 360 px portrait criterion.
- `aria-labelledby` switches between `podium-title` and `summary-title`, matching whichever heading is mounted.

## Messages and helpers

- 22 new `summary_*` keys in `apps/web/messages/{hu,en,de}.json`: the heading, the open and back buttons, the four figure labels and their empty lines, the chart title, its accessible name, the axis labels, the text-alternative list and its empty note, plus `summary_monopoly_repeat`. Regenerate Paraglide after an edit.
- `formatCount` in `apps/web/src/text.ts` formats a whole number in the active language (chart ticks and the Monopoly count).

## Tests

- `apps/web/test/summary-panel.test.ts` (14): the Podium's `summary-open` gating, the four figures and their order, the Rent, top buyer, Monopoly group names, Bankruptcies, the empty lines, one line/marker per Player in their colours, the accessible name and text alternative, the empty series, a null Summary, and hu/de headings. Server-render only (the repo has no DOM test environment); the open/back interaction is the e2e's.
- `apps/e2e/tests/podium.spec.ts`: `showGameOver` now sets a made-up `view.summary` (figures plus a 3-sample series for four Players); the test opens `summary-open`, counts four `chart-line`s, presses `summary-back`, and still ends by clicking the Lobby list link. CI runs it.

Read for: any Summary, Wealth chart or Podium open/back touch, and any result-screen layout change.
