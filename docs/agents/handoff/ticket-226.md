# Ticket #226 (the rematch window) — extension points and gotchas

Branch `agent/issue-226-rematch-a-fixed-window-returns-the-room-when-a-pla`,
from main at `c4edc0f`. The closing slice of spec #175: a Guest who ignores
the Podium cannot block the others. The first vote opens one fixed 30 s window;
when it runs out, the Room returns to Lobby with the Seats that agreed and
releases the rest.

## What landed

- **Pure rules** (`apps/server/src/room/rematch.ts`, tests next to it):
  `REMATCH_WINDOW_MS` (`30_000`), `windowExpiresAt(firstVoteAt)` and
  `windowExpired(now, firstVoteAt)` (at or after the end). `RematchTrigger`
  gains `"RematchExpired"`, so the return's failure log names the window as its
  cause. `seatsAfterRematch` still decides who is kept.
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
  (#225), so connected non-voters are released too.
- **Cancellation**: `cancelRematchWindow` runs in `returnToLobby` (next to the
  vote reset), in `startGame` (a fresh game starts with no votes or window),
  and in `onDispose` (the retention path; a window must not outlive a deleted
  Room). A withdrawal that empties the votes cancels through
  `syncRematchWindow`.
- **Tests**: `apps/server/src/room/rematch.test.ts` (the constant, the end
  boundary), and `apps/server/test/rematch.test.ts`'s `the rematch window`:
  expiry after 30 s releases a connected non-voter and re-lists the open Seat,
  withdrawal cancels and a later vote opens a fresh 30 s, a later vote does not
  restart the window (an ignored third Guest is released), the all-agreed
  return cancels the pending window (no second Lobby push), a withdrawn vote
  leaves retention in charge, an early wake-up waits for the rest, a stale
  wake-up from a replaced window does nothing, and a restart loses the votes
  and the window. The failed-write test now advances the window with the store
  still failing, because the expiry retry is #226's new path.
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
- **A failed write at expiry consumes the window.** `returnToLobby` reports
  through `driver.failed` and leaves the Room ended with its votes and
  retention armed; no new window is armed. A later vote change or Podium leave
  retries, and retention deletes the Room if nothing does. The adjusted
  `a failed Lobby write leaves the Room ended…` test pins this.
- **A released live Guest is not kicked.** They receive the Lobby push while
  still connected with a `me` that matches no Seat (#225's gotcha); the window
  is the first path that can release a _connected_ Guest, so the web side
  relies on the same `lobby`-message navigation.
- **A restart loses the votes and the window because ended Rooms are not
  restored.** `restoreRooms` restores only `store.unfinished()` and
  `deleteAfterRetention` arms the ended ones, so there is no restored Podium to
  offer the rematch again (spec #175, decision 6: votes are Room memory). The
  restart test pins this.
- **The `dispose` cancel is defensive.** Retention (24 h) is well after the
  30 s window, so in the normal flow the window either returned the Room or was
  cancelled; the `onDispose` call covers a Room deleted while a handle is still
  set (and the scheduler contract, not the expiry re-read, is what usually
  keeps a fired timer out).
- **`windowExpired` is the boundary predicate the early-fire re-arm uses.** The
  scheduler already re-waits on a Node timer that fires early, but
  `ManualScheduler.fireEarly`/`lastTaskAt` simulate a late or stale wake-up;
  the pure predicate is what decides that the Room must not return before the
  30 s are up.
