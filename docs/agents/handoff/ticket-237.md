# Ticket #237 (Web: pure Wealth chart geometry and summary view-model): extension points and gotchas

Branch `agent/issue-237-web-pure-wealth-chart-geometry-and-summary-view-mo`. Two pure modules next to `pick/podium.ts`; neither imports React, the DOM or `Intl`, and neither recomputes a number the engine sent (ADR-0001, ADR-0005). #238 draws them.

## `apps/web/src/pick/wealth-chart.ts`

- `wealthChart(series, players, { width, height })` takes the final Summary's `series` (`WealthSample[]` from `@universum/rules`) and the view's `PlayerView[]`, and returns `WealthChart`: `width`, `height`, `plot` (the relation rect), the `x`/`y` `ChartScale`s, `xTicks`/`yTicks` and one `ChartPlayer` per Player with a finite sample.
- A `ChartPlayer` carries the view's `PlayerView` (so #238 calls `playerLook(player.seat)` and `playerName(player.name)`), the polyline's `points` string, the last sample's `marker: { x, y }`, and `start`/`end` Wealth for the text alternative (story 7).
- Layout constants: margins 12 top, 16 right, 28 bottom, 56 left. `plot` is `{ x: 56, y: 12, width: width - 72, height: height - 40 }`, clamped at zero. The component draws the axis labels inside those margins; it owns every string.
- Coordinates are SVG ones (y down) rounded to two decimals, so `points` strings are stable. The y axis is inverted by `scaleOf({ min, max }, { from, to })`.
- Domains come only from the samples that players in the view carry; a Player id the view lacks is ignored and a Player with no sample has no `ChartPlayer`, so an empty (pre-series, v8) game returns `players: []` and no ticks. Domain 0–0 or a one-value range maps to the plot's middle (`x` 320, `y` 142 at 600×300), so no division by zero; the tests pin the one-sample, flat-Wealth and Bankrupt-to-zero cases.
- Ticks: an integer step of roughly `span / 5`, rounded to 1, 2 or 5 × a power of ten; the first tick is the first step inside the domain. A flat range yields one tick at the value, at the middle. Ticks carry `value` and `position` only — #238 formats the y label with `formatCompactMoney` and the x label from the minute.
- `series.toSorted((a, b) => a.minute - b.minute)` returns a sorted copy, never the caller's array; the engine already records minutes monotonic. The old-browser notice checks `toSorted`, so it needs no fallback — see the browser baseline below.

## `apps/web/src/pick/summary.ts`

- `summaryView(players, summary)` mirrors `podiumOrder(players, standings)`: one `playerOf(id)` lookup over a `Map` of the view's `PlayerView[]` drops a figure whose Player the view does not carry (a rented Field's payer or owner, a Monopoly's player, a bankruptcy), so the panel never renders a blank name.
- Returns `SummaryView`: `biggestRent` (`{ payer, owner, field, amount }`) or `null`; `topBuyer` (`{ player, count }`) or `null`; `monopolies` (`{ player, group }[]`, in formed order); `bankruptcies` (`PlayerView[]`, in Bankruptcy order).
- Top buyer: zero purchases for everyone gives `null`; a tie keeps the first Player in the view's order (Seat order), matching `recordRent`'s "an equal one keeps the earlier". Only `players` are scanned, so a stale `fieldsBought` id cannot win.
- `field` and `group` are ids (`FieldId`, `GroupId`); #238 names the Field with `fieldName(FIELDS[field]?.key ?? "")` and the Group with `GROUP_COLORS`. Amounts stay numbers: the panel formats with `formatMoney`, and `summary.test.ts` pins hu/en/de through it.
- It takes a non-null `GameSummary` (`GameSummaryView` satisfies it structurally); the caller gates on `view.summary`, which is null until `gameOver` (ticket #236).

## Tests

- `apps/web/test/wealth-chart.test.ts` (11) pins exact points, ticks, marker, start/end, the empty/one-sample/flat/Bankrupt cases, that unknown Players neither draw nor widen the domain, the y tick values and every `start`/`end` through `formatMoney` in hu/en/de (the `inLanguage`/`plain`/`afterEach` pattern of `money.test.ts`), and that a one-Minute span and a span under 5 Minutes keep the x ticks whole, finite and unique (`0..1`, `0..3`).
- `apps/web/test/summary.test.ts` (7) pins the joined figures, explicit empty values, the Rent's payer/owner/Field, the tie and zero top-buyer cases, missing Players and the hu/en/de money formats.
- Both run in Node; the chart tests use `SIZE = { width: 600, height: 300 }` and the plot constants above, so a margin change breaks them deliberately.

## Browser baseline

- Vite 8.3.6's default `build.target` is `baseline-widely-available`, i.e. chrome111, firefox114, safari16.4 (`node_modules/vite/dist/node/chunks/node.js`); `apps/web/index.html` states that baseline, but its old-browser notice also checks `toSorted`, so the effective floor is Firefox 115. The target is an esbuild syntax target: it does not polyfill a newer `Array.prototype` method.
- `Array.prototype.at` (Chrome 92, Firefox 90, Safari 15.4) is inside that baseline and the notice checks `typeof Array.prototype.at === "function"`, so the two `.at(-1)` calls here stay.
- `Array.prototype.toSorted` (Chrome 110, Firefox 115, Safari 16.0) needs Firefox 115, above the Vite target, so ticket #337 added `typeof Array.prototype.toSorted === "function"` to the notice's `supported` chain. It is a runtime check, not a polyfill: this module and `board/art.ts`, `pick/checklist.ts`, `pick/sale.ts` and `playback/playback.ts` call `toSorted`, and Firefox 114 gets the notice instead of the bundle. The notice copy is unchanged.

## Kept on purpose

- `ChartScale.min`/`max` stay: `ticksOf` reads both. `WealthChart.width`/`height` stay: `components/WealthChart.tsx` reads them for the `viewBox` and the axis label's `y`. Do not trim the exported shapes.

Read for: #238, any `WealthChart`/`Summary` component, or any change to the final Summary's series or figures.
