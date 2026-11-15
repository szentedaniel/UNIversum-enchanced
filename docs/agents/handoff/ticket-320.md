# Ticket 320 — the heartbeat entry test's pinned clock

CI failed on `main` at `ab78cd1`: `test/schedule-heartbeat.test.ts`'s
`the entry > ticks once, reads every workflow's runs and starts no successor` asserted `status` 0 and
got 1. The dry tick ran the real clock, and at 02:27 CET on a Sunday the run failed with
`maintain: could not read its runs: maintain has no weekday in its schedule`: maintenance falls due at
03:19, so last Sunday's occurrence sat seven days and 52 minutes back, outside the walk's window.

## The production fix is not this ticket's

`63342c1` (PR #314) widened the walk to `LOOKBACK_DAYS = 8` in `packages/factory/src/schedule/due.ts`,
so a weekly job's due time that is still ahead today reaches back a full week. Its unit pin is
`test/schedule-due.test.ts`'s `reads a weekly job's runs from last week while its due time is still
ahead`. That commit was already on `main` when this ticket was built; do not undo it.

## What this ticket adds (`packages/factory/test/schedule-heartbeat.test.ts`)

- `CLOCK_MODULE` is written to the test's temp dir as `clock.mjs` and loaded by the spawned entry with
  `NODE_OPTIONS=--import <temp>/clock.mjs`; it replaces `globalThis.Date` with a subclass whose
  zero-argument constructor and `now()` return `FACTORY_TEST_NOW`. The entry is untouched: no
  production clock input was added.
- `runEntry(shim, env = {}, now = RED_MAIN_NOW)` pins the clock for every entry test, so none of them
  depends on the hour CI runs. `RED_MAIN_NOW` is `2026-11-15T01:27:00Z`, the red run's minute.
- `ticks while a weekly job falls due later today` replays that moment: status 0, intake and review
  log their dry dispatches, maintenance is not due yet, and the tick still reaches
  `Dry run: one tick, no successor.` With `LOOKBACK_DAYS = 7` it fails exactly as the red run did
  (`expected 1 to be +0`), which is the regression it guards.

## Gotcha

Any test that spawns `src/schedule/heartbeat-run.ts` (or `tick.ts`) must feed it a clock — through
`runEntry`, a preload of its own, or an injected `now` — because `runTick` and `dueJobs` read Budapest
wall time. A gap in the schedule turns the dry tick red only at certain hours, which is how a
production bug reached CI as a one-hour-a-week test failure instead of a unit test's failure.
