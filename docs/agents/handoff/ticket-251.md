# Ticket #251 (a Guest watches a running game by Room code) — extension points and gotchas

Branch `agent/issue-251-web-watch-a-running-game-by-room-code-on-a-read-on`, from `main` after
#248 (the Room admits spectators) and #249 (the messages carry the count). Spec #179; #252 and #253
build on it. The rules engine, `GameState` and the stored snapshot are untouched.

## The client's role

- **`apps/web/src/stores/room-store.ts`** has `Role = "player" | "spectator"`, `RoomState.role`
  (initial `"player"`), `isSpectator(state)` (the one read of the role: `state.role ===
  "spectator"`) and `seatedMeOf(state)`: this client's own `PlayerId`, or `null` for a spectator.
  `reset()` returns the role to `"player"`, so `leaveRoom()` (and every `attach`) clears it.
- **`isSpectator` is the one read of "is this client a Spectator".** The Lobby's and Game's
  `role` selectors (`spectator` in `Lobby.tsx`, `watching` in `Game.tsx`), `ReconnectOverlay`'s
  `spectator` and `sendIntent`'s guard all read it; `seatedMeOf` is `isSpectator(state) ? null :
  state.me`. Do not add a direct `role === "spectator"` read.
- **`seatedMeOf` is the one read of "me as a Player".** `Game.tsx`, `TurnCard.tsx` and the Board's
  `currentDecision()` pass it to `openDecision`, `chatOpenTo` and `Podium`; a `null` viewer is what
  drops the Roll/Offer/Quarantine/Deal controls, the Decision tray, the pick marks, the quick-chat
  tray, the "Your Turn" heading and the rematch button. Those components needed no spectator
  branch of their own: `openDecision(frame, null, …)` can only answer another Player's waiting
  line, so `bottomSlot` can only be the Turn card or a Field card. Do not add a second Game screen
  or a second "read only" flag; read `seatedMeOf`.
- **`Game.tsx` draws the marker** through the shared `components/WatchingMark.tsx`
  (`data-testid="watching"`, the `watching` message) in the status row (both layouts) when
  `isSpectator(s)`; the Lobby draws the same component. The status row `flex-wrap`s, so a
  spectator's extra chip never clips a control on a phone. The Podium is a `fixed inset-0 z-40`
  overlay, so the marker is behind it at the result screen.
- **The Lobby's spectator state is minimal and temporary.** `Lobby.tsx`'s `if (spectator)` block
  (after the `if (!lobby)` connecting branch) shows the Room's name, `WatchingMark` and
  `watch_waiting`, keeps the `ReconnectOverlay` (a spectator whose Room is disposed is told), and
  offers no Seat, Start, Bot or invite control. #252 replaces exactly that block with the
  read-only Lobby; `started` (a game push) still navigates to `/game/:code`.
- **`ReconnectOverlay`** reads `isSpectator` too: a reconnecting spectator is not told "Your Seat
  is kept for you" (`seatKept` is false), because it holds none. The `lost` overlay's texts are
  the same for both.
- **The Board is not read-only in the sense of "no taps"**: a spectator can still open a Field
  card (inspect) and pan/zoom. That is presentation; the Room answers `SPECTATOR_READ_ONLY` to any
  intent anyway (`apps/server/src/room/game-room.ts`, #248).

## Joining and rejoining

- **`watchRoom(code, password?)`** in `apps/web/src/connection.ts` joins with
  `{ code, password?, watch: true }` and **no `guestToken`** (`joinOptions`'s third argument).
  `joinRoom`/`createRoom` pass `AS_PLAYER` (`false`) and `watchRoom` `AS_SPECTATOR` (`true`) to
  `attach`; `attach`/`listen`/`rejoin`/`tryRejoin` all thread that one boolean, and `listen`
  writes it to `role` with `status: "connected"`. Never call `guestToken()` on the watch path: it
  would make the browser store a token for a Guest that never took a Seat.
- **`tryRejoin` sends `watch: true` for a spectator** (the flag captured by `listen`), so a dropped
  spectator comes back by Room code with no token and no Seat. `SPECTATORS_FULL`, `ROOM_NOT_FOUND`
  (after `RECONNECT.notFoundTries`) and a password refusal end in the normal `lost` state.
- **A passworded Room is not re-entered by the rejoin.** The watch join does not keep the password
  in memory, so a dropped spectator of a passworded Room gets `WRONG_PASSWORD` and goes `lost`; the
  way back is re-entering the Room code and the password (spec #179, story 6). If a later ticket
  wants the drop to survive, keep the password in `connection.ts` for the watch session only.
- **A reload cannot rejoin as a spectator.** The role lives in `roomStore` (the ticket's design),
  not in storage; a reload of `/game/:code` starts as a Player, and `ensureJoined`'s `joinRoom` is
  refused (`ROOM_NOT_FOUND` for a running game). Home's tooltip-free language picker reloads, so
  a spectator picks its language before watching. #252 may persist the role if it wants a reload
  to keep watching; `ensureJoined` would then have to watch too.
- **`ensureJoined` is a no-op for a spectator that is already in the Room** (`code` and
  `status === "connected"` both match), which is what keeps the Lobby→Game navigation from trying
  to take a Seat. Keep that true when #252 draws the Lobby for spectators.

## The Watch action

- **`apps/web/src/screens/join.tsx`**: `useJoin()` returns `join` and `watch`, both feeding one
  `attempt(code, asSpectator, password?)` state machine (`JoinState.asSpectator` keeps the password
  prompt and the retry on the action the Guest chose; `askingFor(state, code, asSpectator)` is the
  one "is the form open for this very try" comparison). `PasswordForm` takes an optional `label`.
  Home's `JoinByCode` renders a second button, `data-testid="watch"`, beside Join in the same form;
  Join stays the form's submit, so Enter still joins.
- The watch path navigates to `/room/:code` like Join; the Lobby forwards to `/game/:code` on the
  first push, so watching a running Room flashes the Lobby's connecting card for one frame.
- **Messages added in hu/en/de**: `watch_button`, `watching`, `watch_waiting`. Run
  `pnpm --filter @universum/web run paraglide` after touching the message files.
- The two Rejection texts a spectator can meet (`rejection_spectators_full`,
  `rejection_spectator_read_only`) were #248's and needed no change.

## Files the ticket named that needed no change

- **`Home.tsx`, `RoomCodeInput.tsx`**: the Room code entry is `JoinByCode` in `join.tsx`, and Home
  already renders it; the Watch button sits in that form.
- **`DecisionTray.tsx`, `DealTray.tsx`**: `openDecision(frame, null, …)` never returns a
  `owner: "me"` Decision, so `bottomSlot` never asks for a tray. Their own `me !== null` guards
  (`TurnCard`'s composer and answer panel) stay for a Player before the `welcome`.
- **`GameMenu.tsx`**: its language picker, sound toggles and quick-chat mute are device settings
  and send no intent; there is no Leave action in it to keep.
- **`test-hooks.ts`**: no new hook; the vitest drives `receivePush`/`receiveLobby` directly and the
  e2e (#253) drives the real Home → Watch flow.

## Tests

- **`apps/web/test/watch-connection.test.ts`** replaces `@colyseus/sdk`'s `Client` with a fake that
  records each `joinById`/`create` options and can drop the connection (`onDrop` then `onLeave`).
  Use `1006` for the drop: `4000` is `CloseCode.CONSENTED`, which the module treats as a closed
  Room. It pins the watch options (no `guestToken`), the `JoinError` code, the watch rejoin, the
  Player rejoin's Guest token, and the two `sendIntent` outcomes: a spectator's intent is neither
  sent (the fake `FakeRoom.sends`) nor locked (`inFlightOf`), a Player's is both.
- **`apps/web/test/watch.test.ts`** server-renders the real `Game`, `Lobby` and `JoinByCode` with
  the `zustand` `useStore` mock (SSR reads the initial store state), `#lib/use-media-query.ts` and
  `#board/Board.tsx` mocked, and the `window.location.origin` stub the invite card needs. A push
  with no events opens its gate at once, so the `awaitingRoll` view shows the Roll only for a
  Player.
- `apps/web/test/room-store.test.ts` has the role cases: `isSpectator` and the `seatedMeOf`
  `null` it feeds.
- **#253**: the Roll button has no `data-testid`; assert its absence by its label
  (`m.game_roll()`), or add the id there. The buy control is `data-testid="offer"`; there is no
  end-turn control (the engine passes the Turn).
