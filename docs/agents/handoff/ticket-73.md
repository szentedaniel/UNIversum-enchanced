# Ticket #73: the in-flight lock in `roomStore`

Branch `ticket/73-in-flight-lock`, spec #72, _In-flight (`roomStore`)_. The
"No optimistic UI" lock left `Game.tsx`'s `useState` and now lives next to the
`seq` it compares.

## What moved

- `RoomState` gains `sentAt: number | null`; `initialRoomState.sentAt` is
  `null`.
- `sendIntent` (`connection.ts`) writes `sentAt` to
  `Math.max(push.seq, rejection?.seq ?? 0)` before `room?.send(...)`, so the
  store still records the send when no Room is attached (the `seq` is 0 then),
  as the old `send()` did.
- `inFlightOf(state)` is beside `RoomState`: true while `sentAt !== null` and
  `Math.max(push.seq, rejection?.seq ?? 0) <= sentAt`. In React:
  `useStore(roomStore, inFlightOf)`; outside React (the Board, #75):
  `inFlightOf(roomStore.getState())`.
- A reset to `initialRoomState` (`leaveRoom`) clears it. A rejoin always brings
  a newer push, so a reconnect needs no special case.
- `Game.tsx` reads the lock once and feeds `canRoll`, `offer`,
  `quarantineChoice` and both trays' `busy`. `sentAt`, `answeredAt`, `pending`
  and the `send()` wrapper are gone: every handler calls `sendIntent`.

## Gotchas

- The comparison is `<=`: a push or Rejection at exactly the sent `seq` does
  not answer the send. That is the deleted `answeredAt <= sentAt` rule.
- `apps/web/test/in-flight.test.ts` imports `connection.ts` and sends through
  `sendIntent` in vitest: the Colyseus client constructs without a browser and
  `room` is null, so nothing is sent. Read the lock with
  `inFlightOf(roomStore.getState())`.
- The e2e `showView` hook still writes `roomStore.push` with `seq + 1`; like
  the connection's counter, that clears the lock.
- The Sale and pick stay open with `busy` while in flight; only the one-tap
  Decisions disappear. That split is #74's `openDecision`, not this store.
