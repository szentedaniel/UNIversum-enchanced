# Ticket 301 — the heartbeat tick also starts the dispatcher

The heartbeat is now the dispatcher's regular trigger: every tick asks whether a `factory-dispatch.yml`
run is queued or in progress and starts one when none is, so free implementer slots fill within ten
minutes of a review finishing, a pull request leaving the gate, a blocker closing or the owner merging.
The dispatcher's hourly cron stays as the backstop for a heartbeat chain that has stopped.

## The tick (`packages/factory/src/schedule/tick.ts`)

- `runTick`'s DI seam gained `dispatcherLive: () => boolean` and `startDispatcher: () => void` beside
  `now`, `dryRun`, `lastTickRun`, `dispatch` and `log`. The decision lives after the nightly-jobs loop:
  a live dispatch run is logged and left alone, a dry run logs
  `Dry run: would dispatch factory-dispatch.yml.` and starts nothing, otherwise the tick starts the
  dispatcher and logs `Dispatched factory-dispatch.yml; free slots fill within ten minutes.`
- A failed live read records `dispatcher: could not read its runs: …` and **starts nothing** for that
  tick; a refused start records `dispatcher: could not dispatch: …`. Both are collected like the
  nightly jobs' errors, so the rest of the tick and the heartbeat's loop continue and the run turns red
  after the relay.
- `tickWiring(repo)` now also returns `dispatcherLive` (one `gh api
  repos/<repo>/actions/workflows/factory-dispatch.yml/runs?status=<status>&per_page=100` page per
  `LIVE_STATUSES` entry, imported from `schedule/heartbeat.ts`) and `startDispatcher` (`gh workflow run
  factory-dispatch.yml --ref main`, **no** `-f scheduled=true`: the workflow declares no inputs, and
  GitHub refuses an undeclared one). `heartbeat-run.ts` and `tick.ts`'s own `main` spread
  `tickWiring` unchanged. Added cost: two runs reads per tick (about 12 an hour) plus the dispatch.
- The dispatcher is outside `due.ts` on purpose: `JOBS` has no `factory-dispatch.yml` entry, its start
  carries no `scheduled` input and its run gets no `(factory tick)` marker, so a tick-started dispatch
  cannot stand in for a nightly job or suppress one. `test/schedule-tick.test.ts` pins both
  (`JOBS` has no entry; a tick that started the dispatcher still dispatches retro after it falls due
  while its own run is recorded under `factory-dispatch.yml` only).
- Why a tick-started dispatch cannot start the same issue twice alongside an event-started one: the
  tick's dispatch joins the `factory-dispatch` concurrency group, so a tick-started run queues behind a
  running event-started one, and the dispatcher reads a queued or in-progress `factory-implement.yml`
  run as running (`runningImplementers`/`issuesOfRuns` in `src/dispatch/dispatch.ts`, `busy` in
  `frontier.ts`), so the later run skips the issues the earlier one started. The issue's "check" needed
  no code change.

## Why the hourly cron stays

Dropping `factory-dispatch.yml`'s `13 * * * *` cron would leave a stopped heartbeat chain (a failed
relay plus a dropped ten-minute cron) with a dispatch only when a push or a finished run happens to
fire one. The cron costs nothing on a public repository and covers exactly the chain the ten-minute
trigger cannot. `docs/agents/factory.md` (Schedules and Dispatch) says the heartbeat is the regular
trigger and the hourly cron the backstop.

## Workflow untouched

`.github/workflows/factory-dispatch.yml` is unchanged: the dispatcher needs no new input, and the
ticket does not ask for a workflow change. Its header comment still names only the events and the
hourly backstop; whoever next owns a workflow change can add the heartbeat sentence.

## Tests

- `test/schedule-tick.test.ts`: the decision tests drive `runTick` with injected deps; a `gh` shim on
  `PATH` (the `dispatch.test.ts` pattern, `GH_SHIM_MATCH`/`GH_SHIM_STDOUT`) pins the two live-status
  URLs and the exact `workflow run factory-dispatch.yml --ref main` argv, and that a queued page starts
  none. A workflow test pins `factory-dispatch.yml`'s `workflow_dispatch` trigger and its
  `factory-dispatch` group (`cancel-in-progress: false`), the serialization the tick relies on. The
  dry-run test expects the dispatcher's log line.
- `test/schedule-heartbeat.test.ts`: the dry tick's entry test now expects
  `JOBS.length + LIVE_STATUSES.length` reads, because a dry tick reads the dispatcher's pages too. Its
  "a workflow's runs cannot be read" test still goes red through the collected errors.

## Gotchas

- Do not start the dispatcher when its live read failed. The tick cannot tell a live run from a dead
  API; "dispatch anyway" would queue a dispatch every ten minutes behind a broken token, while the
  collected error already turns the run red and the next tick retries.
- Keep the start free of `-f scheduled=true` and of the `(factory tick)` marker. The input is
  undeclared (a 422), and a marker would make the dispatcher look like a scheduled job.
- A dry tick reads the dispatcher's live pages so its output is honest; do not move the read behind
  the `dryRun` branch without updating the heartbeat entry test's call count.

Read for: any change to the tick's dispatcher start, `factory-dispatch.yml`'s triggers or the
heartbeat's per-tick API budget.
