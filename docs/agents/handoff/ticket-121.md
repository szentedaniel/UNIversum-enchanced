# Ticket #121 (loadtest wait module) — extension points and gotchas

Branch `agent/issue-121-loadtest-wait-module-one-poll-until-and-wait-until`, from main at `a52ec25`.

## The seam

- `apps/loadtest/src/wait.ts` now holds every wait in the load test: `sleep`, `withTimeout`,
  `pollUntil` and `waitUntil`.
  - `pollUntil(probe, { timeoutMs, intervalMs })` probes at once, then every `intervalMs`, and
    returns `{ ok, atMs }`. A probe that throws counts as "not ready yet". The deadline is
    `Date.now() + timeoutMs`: after a failed probe, a non-positive remaining budget returns
    `{ ok: false, atMs }`; otherwise it sleeps `min(intervalMs, remaining)`, so a long interval
    never overshoots the deadline. `atMs` is the clock reading after the probe that answered (or
    the give-up reading).
  - `waitUntil(atMs)` resolves once the wall clock reaches `atMs` and returns at once when the
    moment is already past. It sleeps in at most 1 s slices, as the runner's old copy did, so a
    timer that fires early cannot end the wait before the moment.
- Both loops' `no-await-in-loop` suppressions live in `wait.ts`; a caller only awaits the helper.

## Callers

- `runner.ts`: `waitForPrometheus` is a `pollUntil` probe on `GET /-/ready` (`intervalMs: 250`),
  throwing when `ok` is false. The runner's own `waitUntil` is gone; the kill/hold schedule and
  the knee samples import the shared one.
- `docker.ts`: `Compose.waitUntilReady(timeoutMs)` is a `pollUntil` probe on
  `execReadyz() === 0` (`intervalMs: 250`) and maps `ok` to `{ ready, atMs }`. Unlike the old
  loop it returns at the timeout instead of sleeping one more interval after a failed probe.

## Tests

- `apps/loadtest/test/wait.test.ts` drives the loop with fake timers and a fake probe: retry until
  true, a throwing probe, the give-up time and probe count, and `waitUntil` before/at/after its
  moment. No test sleeps on a real timer; follow that shape for a new probe.

## Gotcha

- A probe must settle: `pollUntil` does not race it against the deadline, exactly as the old
  readiness loops did not. Use `withTimeout` inside a probe that can hang.
