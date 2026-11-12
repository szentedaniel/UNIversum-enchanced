# Ticket 221 — the factory heartbeat

The tick no longer waits for GitHub's ten-minute cron: one `factory-tick.yml` run ticks every ten
minutes for about 5.5 hours, then dispatches its successor and exits. The cron stays as the safety
net, and exactly one heartbeat is live at a time.

## The loop (`packages/factory/src/schedule/heartbeat.ts`)

- `TICK_INTERVAL_MS` is 10 minutes and `JOB_LIMIT_MS` is GitHub's six-hour job limit.
  `HANDOVER_MARGIN_MS` is 30 minutes and `HEARTBEAT_LENGTH_MS` is derived from the two (5.5 hours).
  `heartbeatWindow(start)` lays out the 33 `ticks` (the first at `start`, the last 10 minutes before
  hand-over) and `handoverAt`, which keeps the 30-minute margin under the job limit.
- `runHeartbeat({ now, sleep, live, tick, relay, log })` is the loop. It calls `live()` once and a
  live answer returns `{ duplicate: true }` without ticking or relaying. It waits to each tick and
  skips a slot a slow previous tick overran, instead of firing the missed ticks back to back. It
  collects a tick's thrown error or its `errors` and keeps ticking, waits to `handoverAt`, then
  relays: `RELAY_ATTEMPTS` (three) tries, `RELAY_RETRY_MS` (a minute) apart. The outcome carries
  `ticks`, `relayed` and every error; the CLI turns the run red with them **after** the relay, so a
  red run still leaves its successor alive.
- `liveHeartbeat(runs, selfId)` is the one-heartbeat rule: a **newer** run (`id > selfId`) in a
  **queued or in-progress** status, that is not a `schedule` (cron) run and does not carry the
  `DRY_RUN_MARKER`. An older run cannot be live: the concurrency group ran it or replaced it with
  this one, and the runs API keeps reporting a cancelled run as queued for a moment. That is the
  cancelled-cron race a successor used to lose: it counted the queued cron it replaced, exited, and
  the cron was cancelled, leaving no chain until the next cron.
- The module owns no timer: the test injects a fake clock and a sleep that advances it, so the
  5.5-hour loop runs in milliseconds. Timing is injected only; there is no `Date.now()` or
  `setTimeout` here.

## The entry (`packages/factory/src/schedule/heartbeat-run.ts`)

- `main` does the live check once at start with one runs-API read per entry in `LIVE_STATUSES`
  (`in_progress`, `queued`), filters by `GITHUB_RUN_ID`, then drives `runHeartbeat` with the real
  clock, `Promise.withResolvers` sleep, the shared tick wiring and `gh workflow run factory-tick.yml
  --ref main` as the relay. `DRY_RUN=1` ticks once and starts no successor; `GITHUB_RUN_ID` is
  required only on the real path.
- `tickWiring(repo)` in `schedule/tick.ts` is the shared GH wiring: `lastTickRun` reads the runs API
  and `dispatch` runs `gh workflow run <file> --ref main -f scheduled=true`. `tick.ts`'s own `main`
  and the heartbeat both use it, and `runTick`'s rules are unchanged.
- A tick still reads the five workflows' runs — about 30 calls an hour at the ten-minute cadence. The
  live check is two calls once per heartbeat start, never per tick.

## Workflow (`.github/workflows/factory-tick.yml`)

- The cron `3-59/10 * * * *` and `permissions: contents: read` stay. `concurrency.group` is
  `factory-tick${{ inputs.dry_run && '-dry-run' || '' }}` with `cancel-in-progress: false`: a dry run
  takes its own group, so it can neither replace the pending successor (tick once and leave no
  chain) nor stall the chain while a heartbeat runs. `timeout-minutes` is 350: above the 5.5-hour
  loop and below GitHub's six-hour job limit, and a test pins it to the module's constants. The step
  runs `node packages/factory/src/schedule/heartbeat-run.ts`.
- `run-name` labels the three kinds of run: `(cron)` for the schedule, `(dry run)` for a dry dispatch
  and `(heartbeat)` for a real one. `liveHeartbeat` ignores the dry marker; the labels also make the
  Actions list readable.
- The relay dispatches while the predecessor is still running, so the successor queues behind it in
  the group; the predecessor exits right after the dispatch. A run that finds a newer non-cron,
  non-dry run queued or in progress exits without ticking; one that finds none starts the loop.
- A tick failure is logged and collected, the loop continues, and the run turns red after the relay.
  A failed relay is retried three times a minute apart; when every attempt fails the run turns red
  and the next cron start builds a new chain.
- `GH_TOKEN` must stay `AGENT_PAT`: a `GITHUB_TOKEN` dispatch starts nothing.

## Tests

- `test/schedule-heartbeat.test.ts` pins the cadence (33 ticks, ten minutes apart, hand-over at 5.5
  hours and inside the job limit), a failed tick not stopping the next, a duplicate start (a newer
  queued run in the page) exiting without ticking or relaying, the cancelled-cron race (an older
  queued cron and a stale in-progress predecessor do not stop the successor), a newer cron and a dry
  run not counting, a clean start ticking and relaying, a refused relay being retried and a
  persistent one reported after three attempts, a predecessor and its successor on one clock (66
  distinct tick times, ten minutes apart), an overrun skipping its slots, the workflow's timeout and
  dry-run group/name, and the entry's `DRY_RUN=1` single tick (one runs read per workflow, no
  dispatch) and its red run when a read fails.
- `test/schedule-tick.test.ts` and `test/schedule-due.test.ts` are unchanged and still green.

## Gotchas

- Do not add per-tick runs-API calls or a per-tick liveness check: the budget is the five workflow
  reads per tick, and liveness is checked once per start.
- Keep the tick's `scheduled=true` dispatch and `(factory tick)` marker exactly as they are; the
  heartbeat only changes who calls `runTick`, never what it decides.
- `timeout-minutes` counts execution, not queue time; the 30-minute gap between the 5.5-hour
  hand-over and the six-hour kill is the margin, and the test fails if the workflow drifts outside
  it.
- The successor is a `workflow_dispatch` run (not delayed like `schedule`); the cron only has to
  catch a dropped relay.
- `liveHeartbeat` compares run ids: GitHub assigns them in creation order, so the id is what tells a
  stale run from the relayed successor. Do not drop the `id > selfId` check without another way to
  ignore a cancelled run the API still lists.

Read for: any factory-tick cron, heartbeat, relay, tick scheduling or `factory-tick.yml` timeout
touch.
