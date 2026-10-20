# Ticket #46 (`pnpm loadtest`) — extension points and gotchas

Branch `ticket/46-loadtest`. Code: `apps/loadtest/src`, compose override `compose.loadtest.yaml`,
reports in gitignored `loadtest-reports/`. The sign-off run itself is #47's (Linux host; see the
spec's *Load test* section); this ticket builds the tool and proves it with a scaled smoke.

## Running

```sh
pnpm loadtest -- --help
pnpm loadtest -- --rooms 20 --ramp 1m --hold 2m --restart-at 1m \
  --http-port 9146 --prometheus-port 9190 --grafana-port 9300 --project loadtest-smoke
```

- Needs Docker + Compose and the host's Node 26. `--build` is on by default; `--no-build` reuses the
  project's images. `--keep` leaves the stack (and its volume) up after the report.
- `compose.loadtest.yaml` is layered on `compose.yaml` and caps `server` at `cpus: 2`,
  `mem_limit: 2g`. It raises only the per-IP limits (`LIMIT_ROOM_CREATIONS_PER_MINUTE/_PER_HOUR`,
  `LIMIT_OPEN_LOBBIES_PER_IP`, `LIMIT_JOINS_PER_MINUTE`, `LIMIT_SEAT_RESERVATIONS_PER_IP`,
  `LIMIT_SOCKETS_PER_IP`, `LIMIT_PASSWORD_FAILURES_PER_IP`). Do not raise `LIMIT_INTENTS_PER_SECOND`,
  `LIMIT_MAX_PAYLOAD_BYTES` or `LIMIT_LIVE_LOBBIES`: the verdict's rejection criteria depend on them
  staying at production values.
- Every run starts with `docker compose down -v` (no Rooms restored from an earlier run) and ends
  with the same unless `--keep`.

## The kill

`docker compose kill server` sends SIGKILL, but Compose marks the container stopped, so the
`restart: unless-stopped` policy does **not** fire. The runner starts it explicitly right after the
kill; `/readyz` is measured from the moment of the kill. On this Mac the smoke measured 0.9 s for 20
Rooms; `restore_duration_seconds` is Prometheus's own boot gauge.

## The generator

- `src/runner.ts` owns the timeline: compose, workers, the SIGKILL at `ramp + restartAfterHold`, the
  `/readyz` wait, the hold end, the Prometheus queries, the verdict and the report.
- `src/worker.ts` is one `worker_threads` thread per core (`--workers`, default
  `os.availableParallelism()`). Each worker owns whole Room groups: every 4th client creates, the
  other 3 `joinById` after 5–30 s. The creator sends `Start` when the Lobby shows every Seat taken.
- Bots act only on the options the view lists (`src/bot.ts`): Roll, Quarantine choice, every Level /
  Buyout / Museum / Decline, PlaceDoubler on each offered Field, TravelErasmus to each offered
  Field, AutoSell / SellFields. #31 and #32 are merged, so those phases are in the union; a phase a
  later ticket adds is unknown here and is left to the Turn timer, and `isGameOver` matches the
  typed `gameOver` phase (plus the strings `gameOver` / `ended`, harmlessly).
- The profile (`src/profile.ts`) is seeded (`--seed`, default 46): linear ramp, 10% password Rooms,
  join delays, and per-game drops. Drops happen only between 30 s and 13 min of a game: a 2-minute
  smoke intentionally has none. 2% of drops return after 60–120 s by Guest token; the rest return in
  2–30 s by `reconnectionToken`.
- Reconnects use the browser client's exact policy, now shared from `@universum/protocol/messages`
  (`RECONNECT`, `backoffDelay`): 8 SDK token attempts (100 ms base, 5 s cap, equal jitter), then
  Guest-token rejoins (500 ms base, 10 s cap), retrying `INTERNAL` / `SERVER_BUSY` / `RATE_LIMITED`
  forever and `ROOM_NOT_FOUND` `RECONNECT.notFoundTries` times. The web's `connection.ts` imports the
  same constants; do not add a second back-off in a new client.
- Client-side measurements: exact RTT samples (intent sent → next newer view), a version
  monotonicity check, `welcome.playerId` comparison after every rejoin, planned/unplanned socket
  closes, and per-seat kill/reseat timestamps. The worker reports `roomsAtKill`, `clientsAtKill`,
  `clientsBackInTime` (≤ 60 s after `/readyz`) and `maxRejoinAfterReadyMs`; the runner folds them into
  `RestartMeasurements`.

## The verdict and report

- `src/config.ts` has every threshold (`THRESHOLDS`) and the profile defaults in one place;
  `src/verdict.ts` is pure: thresholds + `ServerMetrics` + `ClientSummary` + restart measurements →
  one row per criterion (`pass` / `fail` / `skip`). `null` data is `SKIP`, not a failure. A generator
  CPU peak > 70% makes the run invalid and exits non-zero even if every criterion passes.
- `src/metrics.ts` reads the hold in two windows: A = hold start → kill, B = `/readyz` + 2 min →
  hold end. Percentiles and maxima take the worse window, CPU is time-weighted, counters add up. If
  the hold is too short for B (the 2-minute smoke), B is `null`; heap growth is then `SKIP` and the
  other metrics come from A. `rooms_restored` / `restore_duration_seconds` are read at the hold end,
  `rooms{state="playing"}` at the kill, and `process_start_time_seconds` as a range (2 distinct
  values = only the planned restart).
- Report: `renderReport` is pure; `writeReport` writes `loadtest-reports/loadtest-YYYYMMDD-HHmmss.md`
  (UTC). It holds the full git SHA, host CPU model, generator CPU peak, both measured windows, every
  criterion and every raw number. The signed-off report is later committed under `docs/loadtest/`
  (owner's job, #47).
- `--find-knee` starts 100 Rooms in the first minute and adds 100/min (cap `--max-rooms`, default
  2,000). Each minute it takes a worker snapshot and a one-minute Prometheus window, runs the same
  verdict without restart criteria, and stops at the first failing criterion; the report says the
  last passing count and the breaking criterion. It always exits 0.

## Verified on this branch

- Unit tests: 86 in `apps/loadtest/test` (config/args, profile, bot, stats, Prometheus parsing +
  canned metric collection, verdict boundaries, report, docker args).
- Scaled smoke after the v2-modernization merge (Docker Desktop 29.9, Compose 5.6, Apple M3):
  `--rooms 20 --ramp 1m --hold 2m --restart-at 1m` → PASS, `/readyz` 1.1 s, 80/80 seats back in
  15.6 s, 448/448 intents answered, server CPU 0.07 cores, RSS 0.23 GB, generator 2.8%. At a
  2-minute hold the post-restart window is empty (`heap growth` SKIPs) and no planned drop is due
  yet; 80 clients did reconnect by Guest token after the kill.
- `--find-knee --max-rooms 200` → PASS at 200 Rooms (100/min), last passing count 200.
- Full checks after the merge: oxfmt, oxlint, `tsc`, 797 Vitest tests, `TEST_HOOKS=1` web build,
  Playwright 54 passed / 1 skipped on ports 3146/5246.

## Gotchas

- `apps/loadtest` imports only `@universum/protocol/messages` (runtime + types) and `@colyseus/sdk`;
  it must never import rules or server code.
- Node's `worker_threads` `postMessage` trips `unicorn/require-post-message-target-origin`; the
  worker has one `post()` helper with the disable comment. The class methods' sequential retry
  loops are intentional and carry `no-await-in-loop` disables.
- `Room.reconnection.enabled = false` is set on every generated client: the generator drives the
  reconnect itself so it can measure it and choose the token/Guest-token path. With this off, an
  abrupt close reaches `onLeave` with 1006; a `CONSENTED` close means the Room is gone (game over)
  and the group starts a new Room at once.
- The smoke on Docker Desktop/macOS is functional only: Docker's VM CPU accounting makes the server
  caps meaningless there. Only the Linux-host run in #47 counts for sign-off, and the 40-minute,
  1,000-Room run must not be added to CI.
