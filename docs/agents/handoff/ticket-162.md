# Ticket #162 (Sale marks need the room clock) — extension points and gotchas

Branch `agent/issue-162-board-keep-sale-marks-off-until-the-room-clock-is`, from `main` after
#124.

## The change (`apps/web/src/decision/decision.ts`)

- `pickSyncOf`'s third argument is `serverNowMs: number | null`: the server-clock reading, or
  `null` when the room store has no push and the clock is therefore unknown. A Sale (`key` kept)
  returns `{ marks: null, wakeInMs: null }` while it is `null`; a single pick's marks do not read
  the clock and are unchanged.
- The Sale's countdown runs on the server's clock only, so a clock-unknown Sale draws no marks and
  arms no Auto-sell warning timer; the next push's `syncPick` draws them.

## Board (`apps/web/src/board/Board.tsx`)

- `syncPick` passes `push === null ? null : serverNow(push.clockOffset)`. The pre-#124 `Date.now()`
  fallback is gone: it counted the Sale down on an uncorrected client clock.
- The `roomStore` push subscription already calls `syncPick`, so the marks appear with the first
  push; no timer or retry is needed for the clock.

## Tests

- `apps/web/test/decision.test.ts`'s `pickSyncOf` suite pins that an unknown clock keeps the Sale's
  key and marks nothing, with no wake-up.

## Gotchas

- Do not pass a client-clock reading as `serverNowMs` "just so a Sale can draw": the parameter is
  nullable precisely so an unknown clock stays unknown.
- A single pick still marks with `serverNowMs === null` (its marks never read the clock); only the
  Sale branches on it.

Read for: any Decision/Board pick mark, Auto-sell warning or `serverNowMs` argument change.
