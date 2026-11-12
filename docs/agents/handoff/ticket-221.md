# Ticket 221 — the factory heartbeat

The tick no longer waits for GitHub's ten-minute cron: one `factory-tick.yml` run ticks every ten
minutes for about 5.5 hours, then dispatches its successor and exits. The cron stays as the safety
net, and exactly one heartbeat is live at a time.

## The loop (`packages/factory/src/schedule/heartbeat.ts`)

- `TICK_INTERVAL_MS` is 10 minutes, `HEARTBEAT_LENGTH_MS` is 5.5 hours and `JOB_LIMIT_MS` is GitHub's
  six-hour job limit. `heartbeatWindow(start)` lays out the 33 `ticks` (the first at `start`, the last
  10 minutes before hand-over) and `handoverAt`; the hand-over keeps a 30-minute margin under the
  job limit.
- `runHeartbeat({ now, sleep, live, tick, relay, log })` is the loop. It calls `live()` once and a
  live answer returns `{ duplicate: true }` without ticking or relaying, waits to each tick, collects
  a tick's thrown error or its `errors` and keeps ticking, waits to `handoverAt`, then calls `relay()`
  once. The outcome carries `ticks`, `relayed` and every error; the CLI turns the run red with them
  **after** the relay, so a red run still leaves its successor alive.
- `liveHeartbeat(runs, selfId)` is the one-heartbeat rule: a **queued or in-progress** run other than
  this one. A completed run and this run's own id are ignored.
- The module owns no timer: the test injects a fake clock and a sleep that advances it, so the
  5.5-hour loop runs in milliseconds. Timing is injected only; there is no `Date.now()` or
  `setTimeout` here.

## The entry (`packages/factory/src/schedule/heartbeat-run.ts`)

- `main` does the live check once at start with two runs-API reads
  (`.../actions/workflows/factory-tick.yml/runs?status=in_progress|queued&per_page=100`), filters by
  `GITHUB_RUN_ID`, then drives `runHeartbeat` with the real clock, `Promise.withResolvers` sleep, the
  shared tick wiring and `gh workflow run factory-tick.yml --ref main` as the relay. `DRY_RUN=1`
  ticks once and starts no successor; `GITHUB_RUN_ID` is required only on the real path.
- `tickWiring(repo)` in `schedule/tick.ts` is the shared GH wiring: `lastTickRun` reads the runs API
  and `dispatch` runs `gh workflow run <file> --ref main -f scheduled=true`. `tick.ts`'s own `main`
  and the heartbeat both use it, and `runTick`'s rules are unchanged.
- A tick still reads the five workflows' runs — about 30 calls an hour at the ten-minute cadence. The
  live check is two calls once per heartbeat start, never per tick.

## Workflow (`.github/workflows/factory-tick.yml`)

- The cron `3-59/10 * * * *` stays as the safety net; `permissions: contents: read` and
  `concurrency: factory-tick` (`cancel-in-progress: false`) stay. `timeout-minutes` is 350: above the
  5.5-hour loop and below GitHub's six-hour job limit. The step runs
  `node packages/factory/src/schedule/heartbeat-run.ts`.
- The relay dispatches while the predecessor is still running, so the successor queues behind it in
  the group; the predecessor exits right after the dispatch. A run that finds another tick run queued
  or in progress exits without ticking; one that finds none starts the loop.
- A tick failure is logged and collected, the loop continues, and the run turns red after the relay.
  A failed relay (or a failed live read) fails the run loudly; the next cron start builds a new
  chain.
- `GH_TOKEN` must stay `AGENT_PAT`: a `GITHUB_TOKEN` dispatch starts nothing.

## Tests

- `test/schedule-heartbeat.test.ts` pins the cadence (33 ticks, ten minutes apart, hand-over at 5.5
  hours and inside the job limit), a failed tick not stopping the next, a duplicate start (a live
  other run in the page) exiting without ticking or relaying, a clean start ticking and relaying,
  and a failed relay being reported.
- `test/schedule-tick.test.ts` and `test/schedule-due.test.ts` are unchanged and still green.

## Gotchas

- Do not add per-tick runs-API calls or a per-tick liveness check: the budget is the five workflow
  reads per tick, and liveness is checked once per start.
- Keep the tick's `scheduled=true` dispatch and `(factory tick)` marker exactly as they are; the
  heartbeat only changes who calls `runTick`, never what it decides.
- `timeout-minutes` counts execution, not queue time; the 30-minute gap between the 5.5-hour
  hand-over and the six-hour kill is the margin.
- The successor is a `workflow_dispatch` run (not delayed like `schedule`); the cron only has to
  catch a dropped relay.

Read for: any factory-tick cron, heartbeat, relay, tick scheduling or `factory-tick.yml` timeout
touch.
