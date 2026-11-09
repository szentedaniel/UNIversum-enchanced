# Ticket #81 (game push size in the load test report) — notes

Branch `ticket/81-push-size`, based on `per-event-reveals`. Scope: `apps/loadtest` plus one clause in
the README's load-test paragraph. Reports only: no threshold, no verdict row, no server change.

## What the number is

- `jsonBytes` ([`apps/loadtest/src/stats.ts`](../../../apps/loadtest/src/stats.ts)) is
  `Buffer.byteLength(JSON.stringify(message))` over the decoded `GameMessage` the SDK hands
  `onMessage`. The bot never names a field, so a push that grows (the per-event `reveals` of #80)
  needs no change here.
- The wire is msgpack: Colyseus sends a `game` push as `Protocol.ROOM_DATA` (a code byte + the
  message type + the payload, both msgpack), and the SDK's `Room` runs msgpackr's `unpack` before it
  dispatches, with no raw-bytes hook (`onMessage("*")` also sees the decoded object). So the figure is
  the message's JSON size — comparable across runs, not the literal frame size. The report says so
  under the client table.
- Measuring costs one `JSON.stringify` per received push in the generator thread. That is included in
  the generator CPU peak the verdict's run-validity check reads.

## Seams

- `onGame` ([`apps/loadtest/src/worker.ts`](../../../apps/loadtest/src/worker.ts)) pushes a sample for
  every `game` push received, before the stale-version check returns, because a stale push still
  crossed the wire. A push received on a superseded `Room` reference is not counted (the same guard
  every other per-client observation uses).
- Samples cross `worker_threads` as plain numbers: drained on a knee `snapshot`
  (`stats.pushBytes = []`) and copied in `cloneStats`.
- `ClientSummary` gains `pushSamples`, `pushP50Bytes`, `pushP95Bytes`, `maxPushBytes`; each is `null`
  (and `pushSamples` `0`) without samples, which the report prints as `no data`. `maxPushBytes` and
  `maxRttMs` both come from `maxOf` in `stats.ts`.
- Report rows sit with the round trips in `## Client generator`; the push size prints `B` under 1 KB
  and `KB` above (`bytes` here, `bytesShort` in `verdict.ts` since #123).

## Gotchas

- #80 adds `reveals` to `GameMessage` in parallel: keep any push-size change in `jsonBytes`/`pushBytes`
  and it merges cleanly.
- A verdict threshold for the push size would be a spec decision (the ticket forbids one): do not add
  a `THRESHOLDS` entry or a `verdict.ts` row.

## Verified on this branch

- `apps/loadtest` Vitest: 92 tests (5 new: the UTF-8 byte measure, the merged percentiles, the
  no-sample case, and the report's two cases); the whole workspace ran 960.
- Scaled smoke (Docker Desktop 29.9, Apple M3), `--rooms 8 --watchers 2 --ramp 30s --hold 2m
  --restart-at 1m --http-port 9181 --prometheus-port 9281 --grafana-port 9381 --project loadtest-81`
  → PASS, and the report read `| Game push size | 628 samples |`, p50 3.0 KB, p95 3.2 KB, max
  3.3 KB (the generator's own CPU peak stayed at 8.3% of the machine).
- Playwright 69 passed / 1 skipped on ports 3181/5281; `TEST_HOOKS=1` web build and
  `docker compose build` green.
