# Ticket 167 — the factory tick

- `packages/factory/src/schedule/due.ts` holds the schedule as data (`JOBS`, typed `Clock`s and
  `Weekday`s from `shared/budapest.ts`) and the rule: `dueJobs(now, lastRunAt)` returns the jobs whose
  most recent due time is at or before `now`, whose latest start has not passed (exclusive: at 07:00
  Budapest the night jobs wait for the next day), and that have no scheduled run created at or after
  that due time. `lastDueAt(job, now)` is exported for the tick's `created=>=` query.
- Only the tick's own dispatch counts. The tick runs `gh workflow run <file> --ref main -f
  scheduled=true`; every workflow turns that input into a `(factory tick)` run-name marker, and
  `tick.ts` reads it back from the runs API's `display_title`. A manual, dry or per-PR run therefore
  never suppresses the scheduled one; a failed tick dispatch still counts, so it is not retried in a
  loop. The marker lives in `tick.ts` as `TICK_MARKER`.
- `packages/factory/src/schedule/tick.ts` exports `newestTickRun(runs)` and the DI seam
  `runTick({ now, dryRun, lastTickRun, dispatch, log })`. A failed run read skips that job (never a
  blind second dispatch) but the other due jobs still go out; a failed dispatch is collected the same
  way; the CLI fails the run with all of them at the end. `import.meta.main` guards the CLI, so the
  tests import it (`packages/factory/test/schedule-tick.test.ts`). Env: `GH_REPO`, `GH_TOKEN`,
  `DRY_RUN`.
- `packages/factory/src/shared/budapest.ts` is the one Budapest clock: `TIME_ZONE`, `budapestDay`,
  `budapestHour`, `shiftDay`, `mondayIndex` and `budapestAt(day, hour, minute)`. `report/week.ts` and
  `review/window.ts` import it. `budapestAt` picks the earlier instant when the autumn switch repeats
  the clock and shifts forward through the spring gap; the schedule's 02:23 review lands at 03:23 on
  the spring switch day.
- `.github/workflows/factory-tick.yml`: `3-59/10 * * * *` plus `workflow_dispatch` (`dry_run`),
  `concurrency: factory-tick` without cancel, checkout main + setup-node from `.node-version` +
  `pnpm install --frozen-lockfile`. #221 later replaced the five-minute run with a 5.5-hour
  heartbeat (`ticket-221.md`): `timeout-minutes: 350`, and the cron is only the safety net.
  `factory-dispatch.yml` keeps its hourly cron.
- The five nightly/weekly workflows (`factory-intake.yml`, `factory-review.yml`, `factory-retro.yml`,
  `factory-maintain.yml`, `factory-report.yml`) no longer have a `schedule:` trigger and all declare
  the `scheduled` input. In `factory-review.yml`, `dispatch-queued` runs only for a
  `workflow_dispatch` with an empty `pr`; in `factory-maintain.yml`, the `weekly` guard job and the
  `actions: read` permission are gone.
- `intakeAllowed({ scheduled, at })` gates a tick-dispatched intake run on the night window (the
  workflow passes `SCHEDULED` from `inputs.scheduled`); the owner's manual dispatch still always runs.
  The report's schedule gate (`scheduleSlot`, `REPORT_HOUR`, `EVENT_NAME`) is gone: the tick only
  dispatches it from 06:09 Monday, and a manual dispatch always runs. The review run-name still says
  `night queue` for a manual queue drain; the merge gate reads the pull request number from the review
  run it dispatched.
