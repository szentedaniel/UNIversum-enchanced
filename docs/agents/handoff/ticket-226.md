# Ticket #226 (the rematch window) — extension points and gotchas

Branch `agent/issue-226-rematch-a-fixed-window-returns-the-room-when-a-pla`,
from main at `c4edc0f`. The closing slice of spec #175: a Guest who ignores
the Podium cannot block the others. The first vote opens one fixed 30 s window;
when it runs out, the Room returns to Lobby with the Seats that agreed and
releases the rest. A restart loses the votes and the window, but the ended
Room itself comes back so its Podium is offered again.

## What landed

- **Pure rules** (`apps/server/src/room/rematch.ts`, tests next to it):
  `REMATCH_WINDOW_MS` (`30_000`), `windowExpiresAt(firstVoteAt)` and
  `windowExpired(now, firstVoteAt)` (at or after the end). `RematchTrigger`
  gains `"RematchExpired"`, so the return's failure log names the window as its
  cause. `REMATCH_RETRY_MS` (`5_000`), `REMATCH_RETRY_MAX_MS` (`60_000`) and
  `rematchRetryDelay(retries)` (5 s doubling, capped) are the retry back-off.
  `seatsAfterRematch` still decides who is kept.
- **Room** (`apps/server/src/room/game-room.ts`): `#rematchWindow` (`RematchWindow`,
  the object being the identity a late fire is compared against) holds the one
  wake-up. `afterVoteChange` first calls `syncRematchWindow`: an empty vote set
  cancels the window, else the first vote of an ended Room arms it through
  `armRematchWindow(this.now())` → `scheduler.at(windowExpiresAt(...))`. Later
  votes see a pending window and never restart it. `expireRematchWindow` drops
  the handle, ignores a wake-up for a cancelled or replaced window, re-reads
  `game`, `endedAt` and the votes (a Room that returned or was disposed does
  nothing), re-arms when the wake-up fired before
  `windowExpired(now, firstVoteAt)`, and otherwise calls
  `returnToLobby("RematchExpired")` — the same path as the all-agreed return
  (#225), so connected non-voters are released too. A failed return arms the
  next try at `now + rematchRetryDelay(retries + 1)`; the retry keeps the same
  `firstVoteAt` and `RematchWindow` identity, so it is still one window.
- **Cancellation**: `cancelRematchWindow` runs in `returnToLobby` (next to the
  vote reset), in `startGame` (a fresh game starts with no votes or window),
  and in `onDispose` (retention; a window must not outlive a deleted Room). A
  withdrawal that empties the votes cancels through `syncRematchWindow`.
- **Restore** (`apps/server/src/store/room-store.ts`,
  `apps/server/src/store/sqlite-room-store.ts`, `apps/server/src/server.ts`,
  `apps/server/src/room/game-driver.ts`): `RoomStore.ended()` now returns the
  full `StoredRoom` snapshot (not just code and end time), and `restoreRooms`
  restores `store.unfinished()` **and** `store.ended()`. `GameRoom.restore` sets
  `endedAt` from the snapshot, and `GameDriver.resume` arms the Room's own
  retention for it instead of the deadline. The ended Room keeps its Podium:
  a Guest takes their Seat back by Guest token and the next push has
  `view.phase.kind === "gameOver"` with `rematch: []`. Only an ended Room whose
  restore failed gets a retention `deleteAfterRetention` from `restoreRooms`.
- **Tests**: `apps/server/src/room/rematch.test.ts` (the constants, the end
  boundary, the retry back-off), `apps/server/test/room-store.test.ts` (the
  ended snapshot), and `apps/server/test/rematch.test.ts`'s `the rematch
  window`: expiry after 30 s releases a connected non-voter and re-lists the
  open Seat, withdrawal cancels and a later vote opens a fresh 30 s, a later
  vote does not restart the window (an ignored third Guest is released), the
  all-agreed return cancels the pending window (no second Lobby push), a
  withdrawn vote leaves retention in charge, an early wake-up waits for the
  rest, a stale wake-up from a replaced window does nothing, `onDispose` drops
  the pending wake-up, and a restart loses the votes and the window while the
  restored ended Room offers the Podium again. The failed-write test now
  fails the write both at the vote and at expiry and shows the retry returning
  the Room once the store recovers.
- **No web change** (the Podium has no countdown), no stored-shape change and
  `packages/rules` untouched.

## Gotchas

- **One window per Room, keyed to the first vote.** `syncRematchWindow` only
  arms when `#rematchWindow` is `null`; do not call `armRematchWindow` from a
  vote path that can run for a later vote, or the 30 s restarts and a non-voter
  waits longer than the spec allows. `expireRematchWindow` compares the
  `RematchWindow` object it closes over with the live field, so a wake-up for a
  window that a withdrawal or a fresh vote replaced is ignored (the
  `ManualScheduler.lastTaskAt` test fires one by hand).
- **A failed write at expiry is retried, not dropped.** `returnToLobby` reports
  through `driver.failed`, leaves the Room ended with its votes and retention
  armed, and `expireRematchWindow` arms the next try with the back-off. That is
  what keeps "a Player who ignores the Podium must not block the others" true
  through a passing store error; do not "fix" it by consuming the window. The
  retry runs until the write lands, the votes empty, the Room returns, or
  retention disposes it (which cancels through `onDispose`).
- **A released live Guest is not kicked.** They receive the Lobby push while
  still connected with a `me` that matches no Seat (#225's gotcha); the window
  is the first path that can release a _connected_ Guest, so the web side
  relies on the same `lobby`-message navigation.
- **A restart loses the votes and the window, but not the Podium.** Ended Rooms
  are now restored (`restoreRooms` reads `store.ended()`, which carries the
  snapshot; `GameRoom.restore` sets `endedAt`; `GameDriver.resume` arms
  retention). Votes stay Room memory, so the Podium comes back empty and votes
  again. The stored `endedAt` is kept, so retention still deletes at the
  original deadline — never reset it on restore. A restore failure falls back
  to `deleteAfterRetention` in `restoreRooms`, because no Room is up to arm it.
  Consequence: boot holds every ended Room of the last 24 h in memory, as the
  running process already did.
- **`onDispose` of an ended Room must not delete its row.** It only deletes a
  Lobby (`!this.game`); the ended Room's driver retention deletes it and
  `onRetention` disposes it. The window cancel sits there too; the test calls
  `room.onDispose()` directly because a real dispose with clients first runs
  `onLeave`, which can itself return the Room to Lobby. `expireRematchWindow`
  also returns early while `#closing`/`#shuttingDown`, because Colyseus
  disposes asynchronously and a wake-up in that gap must not save the Room as
  a Lobby again.
- **`windowExpired` is the boundary predicate the early-fire re-arm uses.** The
  scheduler already re-waits on a Node timer that fires early, but
  `ManualScheduler.fireEarly`/`lastTaskAt` simulate a late or stale wake-up;
  the pure predicate is what decides that the Room must not return before the
  30 s are up.
