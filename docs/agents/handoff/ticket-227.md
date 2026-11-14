# Ticket #227 (the web's return to the Lobby) — extension points and gotchas

Branch `agent/issue-227-web-the-screen-switches-from-the-podium-back-to-th`,
from `main` at `609c17e`. The web slice of spec #175: when the Room returns to
Lobby after a rematch, the client drops the ended game it shows and lands on the
Lobby with the kept Seats; a Guest whose Seat the rematch released sees that
and can take a free one. The server is untouched.

## What landed

- **One write for a Lobby message.** `receiveLobby(lobby, receivedAt)` in
  `apps/web/src/stores/room-store.ts` writes `lobby` and
  `lobbyClockOffset: lobby.now - receivedAt`. When a game push was held it also
  clears `push` and `sentAt` and calls `resetLog()`; `rejection` and the rest
  of the state stay. A Lobby message with no push held (a rejoin to a Lobby
  that never started a game) is therefore a plain update, as the hazard in the
  ticket asks. `apps/web/src/connection.ts`'s `MESSAGE.lobby` handler is its one
  caller, so the handler no longer writes the store itself.
- **The Playback goes with the push.** `playback/playback-store.ts` subscribes
  to `roomStore.push` (`start()`), so clearing the push clears `frame`, the
  pending boundary timer and the sound cues with no new code: the Board and the
  Podium can never read a stale frame. It was not changed in this ticket.
- **The screen switch.** `inLobbyOf(state)` (`push === null && lobby !== null`)
  is the selector `Game.tsx` subscribes to (`returned`). Its effect navigates
  to `/room/:code` with `replace`, and the screen returns `null` while
  `returned` so the connecting card never flashes. `Lobby.tsx`'s `started`
  (`push !== null`) is false after the return, so the Lobby does not bounce
  back to `/game/:code`; the next game's first push sets it again.
- **The released-Seat view.** `Lobby.tsx`'s `released` is `me !== null &&
  !lobby.seats.some((seat) => seat.playerId === me)`. A released Guest keeps
  the Seat grid, the room code, the invite card and the settings, but gets
  `data-testid="seat-released"` (`lobby_seat_released`) instead of the Start
  button, no Add Bot/Remove Bot controls, and a `data-testid="take-seat"`
  button (`lobby_take_seat`) while an open Seat exists.
- **Taking a Seat.** The button calls `joinRoom(code)`: `attach` leaves the
  seatless connection first and the join carries the same Guest token, so the
  server makes a new Seat (new Player id and name). A `WRONG_PASSWORD` refusal
  opens the existing `useJoin` password form; any other Rejection answers on the
  Lobby's error screen, as a failed address join does.
- **Messages.** `lobby_seat_released` and `lobby_take_seat` in
  `apps/web/messages/{hu,en,de}.json`; Paraglide regenerated.
- **Tests.** `apps/web/test/rematch-return.test.ts` drives the store's public
  writes for the push→Lobby sequence (the drop, the clock offset, the in-flight
  lock, the Event log, the kept Rejection, the plain update path, the lower
  `version` of the next game's first push), asserts `inLobbyOf`, and renders
  `Lobby` in `StaticRouter` for the released and the seated view.

## Gotchas

- **`ensureJoined` early-returns for a connected client**, so a released Guest
  cannot take a Seat through it: the Take a Seat button calls `joinRoom`
  instead. `joinRoom` goes through `attach`, which leaves the current
  connection and resets the store (the Lobby shows its connecting card for the
  moment of the join) before the new Guest-token join. Do not "fix" the
  released Guest by teaching `ensureJoined` to rejoin: the Lobby's mount effect
  would take the Seat for them and they would never see the released view.
- **The released Guest stays connected with a `me` that matches no Seat**
  (#225's gotcha). `receiveLobby` does not clear `me`; `released` is derived
  from the Seat list, never from the connection state.
- **The house has no DOM test environment (#224).** React's server renderer
  reads zustand's _initial_ state, so the test file mocks `zustand`'s
  `useStore` to hand the screens the state the store holds. `Game.tsx` itself
  cannot be server-rendered (`useWide`'s `useSyncExternalStore` has no server
  snapshot), so the navigation is pinned through `inLobbyOf` and the
  `push === null` that clears Lobby's `started`; the effect and the button
  press still need a browser.
- **`receiveLobby` clears the in-flight lock only with a game shown.** Lobby
  intents do not read the lock today (`SeatCard`'s Bot buttons are never
  disabled), so a Lobby message that answers one leaves `sentAt` set; that is
  the ticket's "plain update" path, not an oversight.
- **A game push with a lower `version` is accepted after the return** because
  there is no push left to compare against; that is what lets a new game
  restart `version` at its own start. Do not reintroduce a "last version" field
  that survives the Lobby message.
