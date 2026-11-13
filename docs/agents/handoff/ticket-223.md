# Ticket #223 (rematch votes) — extension points and gotchas

Branch `agent/issue-223-rematch-players-vote-on-a-rematch-after-the-game`, from
main at `67a4a84`. The first slice of spec #175: a Player can ask for a rematch
on the Podium and take it back; the Room counts the votes and everyone hears
them. Nothing returns to the Lobby yet (#225–#226 own that).

## What landed

- **Protocol.** `RoomIntent` gains `{ type: "Rematch" }` and
  `{ type: "WithdrawRematch" }`; `REJECTION_CODES` gains
  `REMATCH_NOT_OFFERED` (no game has ended); `GameMessage.rematch?: PlayerId[]`
  carries the agreed Player ids in Seat order. `ROOM_INTENT_SCHEMAS` parses both
  intents as strict objects, so an extra key is `MALFORMED` like any other.
- **Pure votes.** `apps/server/src/room/rematch.ts`: `castVote` and
  `withdrawVote` return a new `Set<PlayerId>` (repeat calls are harmless), and
  `votersOf(votes, seats)` lists the agreed ids in Seat order, dropping an id
  whose Seat is gone. `rematch.test.ts` next to it pins those five cases.
- **Room memory only.** `GameRoom` keeps `#rematchVotes`, next to `#holds`,
  as a `ReadonlySet<PlayerId>`. It is never written to `StoredRoom`, a
  `SeatRecord`, the store or a migration: a restart loses the votes and the
  Podium simply offers the rematch again (spec #175, decision 6). The set keys
  on the public Player id, so a reconnect (new session) keeps the vote.
- **The two intents.** `ROOM_INTENTS` and `dispatchRoomIntent` register
  `Rematch` and `WithdrawRematch`; `GameRoom.rematch(seat)` and
  `withdrawRematch(seat)` refuse with `REMATCH_NOT_OFFERED` unless
  `game !== null && endedAt !== null`, and a Bot Seat is refused with
  `NOT_OFFERED`. Both then change the vote set and `broadcastVotes()` a
  `MESSAGE.game` push: the current view, empty `events` and `reveals`, `now`,
  and `rematch`.
- **Pushes.** `withVotes(message)` is the one place the vote list is attached:
  the driver's ending push already carries `rematch: []` (the `publish`
  callback runs before `endedAt` is recorded, so `rematchOffered()` also reads
  `game.phase.kind === "gameOver"`), and `sendCurrent` (a reconnection by
  reconnection token or Guest token) sends the same shape, so a Guest who
  dropped and came back sees their vote. A running game's pushes have no
  `rematch` key at all, never `[]`.
- **`startGame` clears the votes**, so a second game in the same Room (later
  tickets) starts its Podium from zero.
- **Web text.** `rejection_rematch_not_offered` in `messages/{hu,en,de}.json`
  and the `REJECTIONS` map in `apps/web/src/text.ts`. No screen change: #224
  draws the button and the chips.
- **Tests.** `apps/server/test/rematch.test.ts` drives real SDK clients through
  a `GameRoom`: refusals in a Lobby and a running game (plus a `MALFORMED`
  extra key), the vote list on every client after the Minute limit ends the
  game (Seat order, empty `events`/`reveals`, repeated cast/withdraw), the
  Guest-token rejoin keeping a vote, and the Bot refusal over the Room's public
  methods.

## Extension points and gotchas

- **#224** reads `push.rematch` (and should treat an absent key as "not the
  Podium"). Do not add the field to a running game's push to make a screen
  simpler: the absence is the signal.
- **#225/#226** hook in after a vote: the all-agreed rule and the fixed window
  are pure functions over `votersOf`'s list and the Seats. Returning the Room to
  Lobby state must clear `#rematchVotes`, clear `this.endedAt` in the same save,
  cancel retention (`GameDriver`'s `#cancelDeletion` lives in the driver) and
  `listAgain()`/`syncListing()` — none of that exists yet.
- **A dropped Guest at the Podium is not held.** `onDrop` returns early once
  `endedAt !== null` (the #35 decision that an ended game holds no Seat), so
  the only way back is the Guest token (`takeBack` → `sendCurrent`); a
  reconnection token from a Podium drop does not exist. `sendCurrent` is where
  a future hold would also pick the votes up.
- **Do not key votes on `sessionId`** and do not log them; the ids in
  `rematch` are public Player ids, as the wake-up and Seat paths already use.
- **`room.endGame()` in a test** sets `endedAt` without a `gameOver` phase; the
  votes are still offered (the check is `endedAt !== null`), and the ending
  push is the only one whose `rematch` comes from the phase.
