# Ticket #197 (a joining Guest replaces a Bot) — extension points and gotchas

Branch `agent/issue-197-a-joining-guest-replaces-a-bot`, from main at `9f1bc31`.

## What landed

- `GameRoom.authorize` (the static `onAuth`) answers `ROOM_FULL` for a full
  Lobby only when no Seat is a Bot (`seat.bot === true`); with a Bot the join
  goes on to the usual password check and Seat reservation.
- `GameRoom.onJoin` replaces the first Bot's Seat in place: the Guest gets a new
  `playerId` and a generated name, the Seat keeps its join-order index, and the
  Lobby stays full (so `syncListing` keeps it off the list).
- `apps/server/test/bots.test.ts` covers both branches: "gives a Guest the Seat
  of a Bot when it joins a full Lobby" pins the Seat index and the Bot id
  leaving, and "still answers ROOM_FULL when every Seat of a full Lobby has a
  Guest" pins the no-Bot answer.

## Gotchas

- The replaced Seat is saved before `this.seats` changes, like any join: the
  `seats` array is the driver's live state.
- `AddBot` still answers `ROOM_FULL` on a full Lobby; only a joining Guest
  displaces a Bot.
- `seatOfToken` runs before the full check in both `onAuth` and `onJoin`, so a
  Guest taking their own Seat back never replaces a Bot.
- The password check still follows the full check: a full Lobby with a Bot and a
  password asks the joining Guest for it.
