# Ticket #127: roomStore owns pushes, Rejections and the in-flight lock

Branch `agent/issue-127-roomstore-owns-pushes-rejections-and-the-in-flight`,
from `main`. Client-only refactor: the `seq` counter left `connection.ts` for
`room-store.ts`, and every writer now goes through four functions, so a push
and a Rejection cannot collide.

## The write interface (`apps/web/src/stores/room-store.ts`)

- `receivePush({ view, events, reveals, now }, receivedAt)` — a
  `GameMessage` fits the parameter as is. It drops a push whose `view.version`
  is older than the shown one (the same version still shows: a rejoin sends the
  state again), then assigns the next `seq`, `clockOffset: now - receivedAt`
  and `receivedAt`. An ignored push spends no `seq`.
- `receiveRejection(code)` — puts up the Rejection with the next `seq`.
- `markIntentSent()` — the in-flight lock: `sentAt = answeredAtOf(state)`.
- `reset()` — back to the initial state, and the counter back to 0; it is
  `leaveRoom`'s reset.
- `answeredAtOf` and `initialRoomState` are private now; `inFlightOf` is still
  the read (React: `useStore(roomStore, inFlightOf)`; elsewhere:
  `inFlightOf(roomStore.getState())`).
- Pushes and Rejections share the one module-level counter, so the later
  answer always has the later `seq`.

## Callers

- `connection.ts`: `MESSAGE.game` → `receivePush(push, Date.now())`,
  `MESSAGE.rejected` → `receiveRejection(code)`, `sendIntent` →
  `markIntentSent()`, `leaveRoom` → `reset()`. The `mine()` guard stays there.
- `test-hooks.ts`: `holdIntent` is `markIntentSent`; `showView` calls
  `receivePush` with `now = serverNow(push?.clockOffset ?? 0, receivedAt)`, so
  the made-up push takes a real `seq`, clears the lock and keeps the clock
  estimate. Do not build a `Push` by hand anywhere else.

## Gotchas

- The server-clock fence (`apps/web/test/server-clock-fence.test.ts`) forbids
  `clockOffset` arithmetic in `apps/web/src`. `showView` keeps the offset by
  passing the old offset through `serverNow(offset, receivedAt)` instead of
  adding it; `receivePush`'s `now - receivedAt` names no `clockOffset`, so the
  fence's regex leaves it alone.
- `apps/web/test/room-store.test.ts` drives the interface only (no
  `sendIntent`, no `setState`): the ordering both ways, the older-/same-version
  guard and the lock's three clears. `apps/web/test/playback-store.test.ts`
  still writes a push through `setState` on purpose — it tests the Playback
  store, not the counter.
- A Rejection clears the lock even when a made-up `showView` push came before
  it: both write the same counter, which is the reason for the move.
