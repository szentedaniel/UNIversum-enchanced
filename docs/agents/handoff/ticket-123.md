# Ticket #123 (one set of display formatters and one maxOf) — notes

Branch `agent/issue-123-loadtest-number-formatting-one-set-of-formatters-s`, from `main`.

## The units

`apps/loadtest/src/verdict.ts` owns every unit the verdict and the report print, because it already
owns the criteria's thresholds and their display:

- `ms(value)`, `seconds(value)` — one decimal plus the unit.
- `gib(value)` — `1024 ** 3` bytes as `GB` (the label stays `GB`, as the thresholds and the host RAM
  line always had it).
- `ratio(value)` — a 0–1 fraction as a one-decimal percent.
- `count(value)` — a whole number, rounded.
- `cores(value)` — two decimals plus `cores`.
- `bytesShort(value)` — a push size: whole `B` under 1 KB, one-decimal `KB` above; the only byte
  unit that is not `gib`.

`report.ts` imports these instead of defining its own copies. A new unit goes here, so a threshold
string (`≤ 12.0 ms`) and the same number in the report's server table cannot drift. The report keeps
`shortDuration` (whole seconds, `10m`, `10m 30s`) local: nothing in the verdict prints a run length.

## The one maxOf

`stats.ts` exports `maxOf(values: readonly (number | null)[]): number | null` — the largest value,
`null` when there is none or every value is `null`. It takes the array rather than `...values` so the
run's sample arrays never spread into call arguments; `metrics.ts` passes the two measurement windows
straight in and has no private copy.

## Tests

- `test/verdict.test.ts` pins each unit's output, including `bytesShort` under and over 1 KB.
- `test/report.test.ts` pins that a server-metric cell prints the same string as the verdict
  criterion's `actual` for that number.
- `test/stats.test.ts` pins `maxOf` over numbers, an empty array and an array of `null` windows.
