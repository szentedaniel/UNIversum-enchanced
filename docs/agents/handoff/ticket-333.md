# Ticket #333 — factory review follow-ups on the Summary (#325)

Branch `agent/issue-333-factory-review-follow-ups-325`, based on `main`. All in `apps/web`; no protocol, rules or server change.

## The empty series (#238's follow-up)

- `WealthChart({ series, players })` computes `wealthChart(...)` and **returns null when it found no Player line**, so neither the figure nor a note reaches the screen: a pre-series save's `series: []` draws no empty chart frame. The `wealth-chart-empty` test id and the `summary_chart_empty` key are gone from `apps/web/messages/{hu,en,de}.json`; regenerate Paraglide after touching the message files.
- `apps/web/test/summary-panel.test.ts` pins it: an empty `series` renders no `wealth-chart` test id and no empty note; it keeps 15 tests.

## Shared helpers

- `cssHex(color: number)` sits beside `GROUP_COLORS` in `apps/web/src/board/colors.ts` and is the one colour-to-CSS-hex conversion: `FieldCard`'s memoised `band()` styles, the Summary's Monopoly dot (`cssHex(GROUP_COLORS[group])`), and `apps/web/test/players.test.ts` use it. `apps/web/test/colors.test.ts` pins the channel padding with `GROUP_COLORS[8]` (`#0572bb`).
- `PlayerLine` in `apps/web/src/components/PlayerToken.tsx` (`{ seat, children, className? }`) is a `PlayerToken` at size 14 beside a line of text. The Summary's Rent, top-buyer and Bankruptcies rows and the Wealth chart's `chart-player` list use it; every `data-testid` and `data-player` stays on the surrounding `<li>`, and the chart keeps its own list markup.
- `groupUniversities` stays in `Summary.tsx`: moving it to `board/colors.ts` would make that module import `#text.ts` (the messages) and it has no second caller.

## One label per landmark

- The outer `<section data-testid="podium">` carries `aria-labelledby="podium-title"` only while the Summary is closed. While the Summary is open it has no `aria-labelledby`, so `summary-title` labels the Summary's section alone (a section without a name is not a landmark). The e2e asserts one `region` named "The game in numbers" and no `aria-labelledby` on the Podium while open; the closed Podium and the Summary each keep their own label in `summary-panel.test.ts`.

## The podium body split

- `apps/web/src/components/PodiumBody.tsx` holds the podium itself: `PodiumBody({ view, phase, rematch, me, busy, onOpenSummary })`, the `REASONS`/`HEIGHTS` tables and `PodiumPlace`, the `podium-title` through the `summary-open` button. `apps/web/src/components/Podium.tsx` keeps the `showSummary`/`openSummary` state, the confetti, the scroll box and the `Back to the Lobby list` link; the Game screen's Decision slot (`slot.kind === "podium"`) still gates when the Podium mounts. Pure move: every `podium*`, `rematch-*` and `summary-open` test id and their order are unchanged.

## e2e

- `apps/e2e/tests/podium.spec.ts` now, while the Summary is open, sets the viewport to `360 × 640`, asserts the `Back to the Lobby list` link is visible and **fully** in the viewport (`toBeInViewport({ ratio: 1 })`), then restores the project viewport before `summary-back`. CI runs it.

Read for: any Summary, Wealth chart, podium-body or result-screen label/empty-state touch.
