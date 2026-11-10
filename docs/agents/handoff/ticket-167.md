# Ticket 167 — the factory tick

- `packages/factory/src/schedule/due.ts` holds the schedule as data (`JOBS`) and the rule:
  `dueJobs(now, lastRunAt)` returns the jobs whose most recent due time is at or before `now`, whose
  latest start has not passed, and that have no run created at or after that due time. Any run counts,
  whatever its event or conclusion, so a failed job is not retried in a loop. `lastDueAt(job, now)` is
  exported for the tick's `created=>=` query; the tests drive only `dueJobs`
  (`packages/factory/test/schedule-due.test.ts`).
- `packages/factory/src/shared/budapest.ts` is now the one Budapest clock: `TIME_ZONE`,
  `budapestDay`, `budapestHour`, `shiftDay`, `mondayIndex` and `budapestAt(day, hour, minute)`.
  `report/week.ts` and `review/window.ts` import it. `budapestAt` picks the earlier instant when the
  autumn switch repeats the clock and shifts forward through the spring gap; the schedule's 02:23
  review lands at 03:23 on the spring switch day.
- `packages/factory/src/schedule/tick.ts` reads each workflow's newest run with
  `gh api "repos/$GH_REPO/actions/workflows/<file>/runs?created=>=<lastDueAt>&per_page=1"`, then runs
  `gh workflow run <file> --ref main` for each due job. `DRY_RUN=1` prints the due jobs. Env: `GH_REPO`,
  `GH_TOKEN`, `DRY_RUN`.
- `.github/workflows/factory-tick.yml`: `3-59/10 * * * *` plus `workflow_dispatch` (`dry_run`),
  `timeout-minutes: 5`, `concurrency: factory-tick` without cancel, checkout main + setup-node from
  `.node-version` + `pnpm install --frozen-lockfile`. `factory-dispatch.yml` keeps its hourly cron.
- The five nightly/weekly workflows (`factory-intake.yml`, `factory-review.yml`, `factory-retro.yml`,
  `factory-maintain.yml`, `factory-report.yml`) no longer have a `schedule:` trigger. In
  `factory-review.yml`, `dispatch-queued` runs only for a `workflow_dispatch` with an empty `pr`; in
  `factory-maintain.yml`, the `weekly` guard job and the `actions: read` permission are gone.
- The report script's `scheduleSlot`/`EVENT_NAME` gate is unchanged: only a `schedule` event is gated,
  and the tick dispatches with `workflow_dispatch`. The review run-name still says `night queue`; the
  merge gate reads the pull request number from the review run it dispatched.
