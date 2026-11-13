# Ticket #225 (rematch return to Lobby) — extension points and gotchas

Branch `agent/issue-225-rematch-the-room-returns-to-lobby-once-every-conne`,
from main at `febfbc2`. The second slice of spec #175: once every Guest with a
live connection has voted (at least one vote), the ended Room is a Lobby
again with the agreed Seats. The fixed window for a Guest who ignores the
Podium is #226.

## What landed

- **Pure rules** (`apps/server/src/room/rematch.ts`, tests next to it):
  `RematchSeat` (`{ playerId, bot? }`), `RematchVote`/`RematchTrigger` (the two
  vote intents, plus `PodiumLeft`), `shouldReturn(seats, votes, isConnected)`
  (true when at least one vote is cast and every Guest Seat with a live
  connection has voted; a dropped Seat does not block and a Bot neither votes
  nor blocks) and `seatsAfterRematch(seats, votes)` (the voters and every Bot
  Seat, in join order, unchanged; the one `keptByRematch` predicate decides
  both). Both are generic over the Seat type, so `GameRoom` passes
  `SeatRecord`s and `isSeatConnected` straight in.
- **Driver** (`apps/server/src/room/game-driver.ts`): `saveLobby(seats)`
  writes one snapshot with `game: null`, `endedAt: null` and the kept Seats
  through `#save`, then cancels `#cancelDeletion`. The cancel comes after the
  save: a throwing store leaves the ended snapshot and the deletion armed, and
  in-memory state unchanged. A later `#end` arms retention again.
- **Room** (`apps/server/src/room/game-room.ts`): `rematch`/`withdrawRematch`
  call `afterVoteChange(intent)`, which broadcasts the votes unless
  `returnIfAgreed` returned the Room. `returnIfAgreed` is also called from
  `onLeave` for a Seat of an ended Room (`PodiumLeft`): a non-voting Guest who
  drops or leaves stops blocking the others, and their leave can itself
  complete the agreement. `returnToLobby(cause)` keeps `seatsAfterRematch`'s
  Seats, clears `game`, `endedAt` and the votes, re-opens the Lobby in the
  abuse guard (`lobbyReopened` with the creator's bucket or `null`), gives
  each kept Guest Seat with no live connection a 60 s Lobby hold
  (`hold(seat, null)`), then `broadcastLobby()` — which runs `syncListing()`,
  so free Seats put the Room back on the Lobby list and a full one stays off
  it. Room name, code, password, creator id and settings are untouched;
  `Start` sets up a fresh game from the kept Seats.
- **Creator bucket**: `#creatorBucket` (memory only) is recorded in `onJoin`
  next to `lobbyCreatedBy`; a restored Room has none, and the guard's counters
  reset with the process anyway, so a restored Lobby is only counted in the
  live-Lobby total (as before).
- **Failed write**: `returnToLobby` reports through `driver.failed` and tells
  its caller it did not return, so a vote still goes out; the vote stands, the
  Room stays ended, retention still deletes it, and a later vote change or
  Podium leave retries.
- **Tests**: `apps/server/src/room/rematch.test.ts` (the pure rules),
  `apps/server/test/rematch.test.ts` (`returning to Lobby`: both votes, a
  dropped non-voter's release and Lobby-list entry, the last non-voter's own
  drop completing the agreement, kept ids/names/Bots and Room identity, the
  stored snapshot and cancelled retention, restarts on both sides, a fresh game
  and a second retention, the plain retention deletion, the live-Lobby cap, the
  failed write, a held Seat taken back by Guest token, and a returned Lobby
  disposed only after its last Guest leaves), and
  `apps/server/test/game-driver.test.ts` (`returning to Lobby`: one save,
  cancelled deletion, a throwing store).

## Gotchas

- **`autoDispose` stays off after a game.** Colyseus's `autoDispose` setter
  clears its pending empty-Room timer but leaves the handle in the private
  `_autoDisposeTimeout`, and `#_disposeIfEmpty` refuses to dispose while a
  handle is set (`@colyseus/core` 0.18.19). Switching it off at `Start` after a
  return (a Lobby briefly had it on) therefore hung the Room in `DISPOSING` on
  the next retention and leaked it, including at shutdown. The Room now never
  turns it back on once it played or was restored: `disposeIfAbandoned()` (from
  `onLeave` and `expire`) disposes an emptied Lobby explicitly, with the same
  rule as the old restored-Lobby wait (no client, no Seat waiting for a Guest).
  `waitIfRestored` is gone; `autoDispose` is only true for a Lobby that never
  played. Do not set it to `true` anywhere else.
- **A kept Seat that dropped on the Podium has no reconnection.** `onDrop`
  still returns early for an ended Room, so the return arms `hold(seat, null)`
  as a restored Lobby does; the Guest comes back with their Guest token
  (`takeBack` → `sendCurrent` → `broadcastLobby`), and the hold's 60 s keeps
  the Lobby alive while nobody is connected. `onLeave` re-checks the agreement
  for an ended Room (`returnIfAgreed("PodiumLeft")`): a drop's `onLeave`
  follows its `onDrop` at once, a consented leave gets there directly, and the
  last non-voter leaving can return the Room without another vote. The
  retention's forced closes must not return it: `#closing`, set in the driver's
  `onRetention`, makes `onLeave` skip the re-check while the Room disposes.
- **`disposeIfAbandoned` reads `clients` after the leaving one is gone.**
  `Room._onLeave` deletes the client from `clients` before it calls
  `onDrop`/`onLeave` (`@colyseus/core` 0.18.19), so the last leave sees an
  empty Room and disposes the Lobby; the sequential-leave test pins it.
- **A released Seat is only removed from `seats`.** The Guest's client (if it
  were still connected) is not kicked and the server ignores its intents
  (`onIntent` finds no Seat). Under the all-connected rule a released Guest is
  always disconnected, so #226 is the first ticket that can release a live one.
- **The return is signalled by a `Lobby` message, not a game push** — nothing
  carries the old votes or `gameOver` any more. The web app must treat a
  `lobby` message after a game as "back in the Lobby": navigate from
  `/game/:code` to `/room/:code` and clear the store's `push` (otherwise
  `Lobby.tsx`'s `started = push !== null` sends it straight back). The released
  Guest stays connected with a `me` that matches no Seat.
- **#226 hooks here**: the window's expiry should repeat the return path
  (`returnToLobby`) without a vote change, and must clear the timer in `#end`
  or after the return. Nothing else is armed for the Lobby.
- **Stored shape unchanged:** the returned snapshot reuses `game: null,
  endedAt: null`; no migration, and `packages/rules` is untouched.
