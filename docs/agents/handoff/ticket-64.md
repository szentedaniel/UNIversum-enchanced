# Ticket #64 (serverNow moves to the protocol) — what changed and gotchas

Branch `ticket/64-server-now-protocol` (on `v2-modernization`), spec #63. The
server-clock estimate is one export of `@universum/protocol/messages` now, so
the web app, the e2e specs and the load test share it.

## Where the estimate lives

- **`serverNow(clockOffset, clientNow = Date.now())`** is in
  `packages/protocol/src/messages.ts` (its own `clocks` section), tested by
  `packages/protocol/test/server-clock.test.ts`. The web app's old
  `lib/server-clock.ts` is **deleted**: import `serverNow` from
  `@universum/protocol/messages`, never write `Date.now() + clockOffset` again.
- Web callers: the Turn ring (`screens/TurnRing.tsx`), the Minute pill
  (`components/GameHud.tsx`), the Board's Sale marks (`board/Board.tsx`) and the
  Lobby's held-Seat countdown (`screens/Lobby.tsx`). `SaleTray`/`PickTray` only
  pass `clockOffset` down to `TurnRing`.
- `apps/web/src/connection.ts` still _computes_ the offsets
  (`lobby.now - Date.now()`, `now - receivedAt`). Those are offsets, not
  estimates, and they stay there: do not route them through `serverNow`.
- The load test: `apps/loadtest/src/worker.ts` `act(view, serverOffset)` takes
  the offset at receipt (`message.now - Date.now()`) and calls
  `serverNow(serverOffset)` for the Playback wait. A new worker wait that
  compares a server timestamp uses the same call.

## The e2e hook

- Code inside `page.evaluate` cannot import modules, so the web test hooks
  (`apps/web/src/test-hooks.ts`) expose **`serverNow()`**: the latest push's
  `clockOffset`, or `roomStore.lobbyClockOffset` before the first push. The
  type mirror is in `apps/e2e/tests/test-hooks.ts`; in a spec write
  `window.universumTest!.serverNow()`.
- **Read it once per made-up push** and add lead times to that reading
  (`const now = hooks.serverNow(); view.turnDeadline = now + 18_000;`). Two
  calls differ by a millisecond or two and would hide a clock that is wrong.
- `showView` keeps `clockOffset: push?.clockOffset ?? 0`, so a made-up push
  _before_ any real one estimates with the local clock. That is the intended
  behaviour (there is no server clock yet), not a bug to fix in a spec.
- `helpers.ts`'s `PageDump` and `failure-dump.spec.ts` still record
  `clockOffset` as a plain property. It is not arithmetic and the fence rule
  below does not match it.

## Fence

- The old `playback-fence.test.ts` rule 2 now reads "the server clock is
  estimated only by serverNow in @universum/protocol/messages" (#68 moved it to
  `apps/web/test/server-clock-fence.test.ts`). **No web file is exempt** any
  more (there is no `lib/server-clock.ts`), so the predicate that used to allow
  it is gone; `playbackOfPush`'s
  `const actsAfter = push.view.actsAfter - push.clockOffset` in
  `playback/playback.ts` is still the one named exception (a server timestamp
  to a client one).
- #68 widened the same check to `apps/e2e/tests` and `apps/loadtest/src`; a
  hand-written estimate in those trees is caught by
  `apps/web/test/server-clock-fence.test.ts` now.
- `Date.now() + <client-local value>` that is not a clock offset is fine and
  unmatched: `join.tsx`'s `retryAfter` countdown, the load test's timers, the
  editor's own `Date.now()`.
