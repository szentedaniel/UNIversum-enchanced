# Ticket #251 (a Guest watches a running game by Room code) — extension points and gotchas

Branch `agent/issue-251-web-watch-a-running-game-by-room-code-on-a-read-on`, from `main` after
#248 (the Room admits spectators) and #249 (the messages carry the count). Spec #179; #252 and #253
build on it. The rules engine, `GameState` and the stored snapshot are untouched.

## The client's role

- **`apps/web/src/stores/room-store.ts`** has `Role = "player" | "spectator"`, `RoomState.role`
  (initial `"player"`), and `viewerOf(state)`: this client's own `PlayerId`, or `null` for a
  spectator. `reset()` returns the role to `"player"`, so `leaveRoom()` (and every `attach`)
  clears it.
- **`viewerOf` is the one read of "me as a Player".** `Game.tsx`, `TurnCard.tsx` and the Board's
  `currentDecision()` pass it to `openDecision`, `chatOpenTo` and `Podium`; a `null` viewer is what
  drops the Roll/Offer/Quarantine/Deal controls, the Decision tray, the pick marks, the quick-chat
  tray, the "Your Turn" heading and the rematch button. Those components needed no spectator
  branch of their own: `openDecision(frame, null, …)` can only answer another Player's waiting
  line, so `bottomSlot` can only be the Turn card or a Field card. Do not add a second Game screen
  or a second "read only" flag; read `viewerOf`.
- **`Game.tsx` draws the marker** as `data-testid="watching"` in the status row (both layouts)
  when `role === "spectator"`. The status row now `flex-wrap`s, so a spectator's extra chip never
  clips a control on a phone. The Podium is a `fixed inset-0 z-40` overlay, so the marker is
  behind it at the result screen.
- **The Lobby's spectator state is minimal and temporary.** `Lobby.tsx`'s `if (spectator)` block
  (after the `if (!lobby)` connecting branch) shows the Room's name, `data-testid="watching"` and
  `watch_waiting`, with no Seat, Start, Bot or invite control. #252 replaces exactly that block
  with the read-only Lobby; `started` (a game push) still navigates to `/game/:code`.
- **The Board is not read-only in the sense of "no taps"**: a spectator can still open a Field
  card (inspect) and pan/zoom. That is presentation; the Room answers `SPECTATOR_READ_ONLY` to any
  intent anyway (`apps/server/src/room/game-room.ts`, #248).

## Joining and rejoining

- **`watchRoom(code, password?)`** in `apps/web/src/connection.ts` joins with
  `{ code, password?, watch: true }` and **no `guestToken`** (`joinOptions`'s third argument).
  `joinRoom`/`createRoom` pass `role = "player"`; `attach`/`listen` write the role with
  `status: "connected"`. Never call `guestToken()` on the watch path: it would make the browser
  store a token for a Guest that never took a Seat.
- **`tryRejoin` sends `watch: true` for a spectator** (the role captured by `listen`), so a dropped
  watcher comes back by Room code with no token and no Seat. `SPECTATORS_FULL`, `ROOM_NOT_FOUND`
  (after `RECONNECT.notFoundTries`) and a password refusal end in the normal `lost` state.
- **A passworded Room is not re-entered by the rejoin.** The watch join does not keep the password
  in memory, so a dropped watcher of a passworded Room gets `WRONG_PASSWORD` and goes `lost`; the
  way back is re-entering the Room code and the password (spec #179, story 6). If a later ticket
  wants the drop to survive, keep the password in `connection.ts` for the watch session only.
- **A reload cannot rejoin as a spectator.** The role lives in `roomStore` (the ticket's design),
  not in storage; a reload of `/game/:code` starts as a Player, and `ensureJoined`'s `joinRoom` is
  refused (`ROOM_NOT_FOUND` for a running game). Home's tooltip-free language picker reloads, so
  a watcher picks its language before watching. #252 may persist the role if it wants a reload to
  keep watching; `ensureJoined` would then have to watch too.
- **`ensureJoined` is a no-op for a spectator that is already in the Room** (`code` and
  `status === "connected"` both match), which is what keeps the Lobby→Game navigation from trying
  to take a Seat. Keep that true when #252 draws the Lobby for spectators.

## The Watch action

- **`apps/web/src/screens/join.tsx`**: `useJoin()` now returns `join` and `watch`, both feeding one
  `enter(code, watching, password?)` state machine (`JoinState.watching` keeps the password prompt
  and the retry on the action the Guest chose). `PasswordForm` takes an optional `label`. Home's
  `JoinByCode` renders a second button, `data-testid="watch"`, beside Join in the same form; Join
  stays the form's submit, so Enter still joins.
- The watch path navigates to `/room/:code` like Join; the Lobby forwards to `/game/:code` on the
  first push, so watching a running Room flashes the Lobby's connecting card for one frame.
- **Messages added in hu/en/de**: `watch_button`, `watching`, `watch_waiting`. Run
  `pnpm --filter @universum/web run paraglide` after touching the message files.
- The two Rejection texts a watcher can meet (`rejection_spectators_full`,
  `rejection_spectator_read_only`) were #248's and needed no change.

## Tests

- **`apps/web/test/watch-connection.test.ts`** replaces `@colyseus/sdk`'s `Client` with a fake that
  records each `joinById`/`create` options and can drop the connection (`onDrop` then `onLeave`).
  Use `1006` for the drop: `4000` is `CloseCode.CONSENTED`, which the module treats as a closed
  Room. It pins the watch options (no `guestToken`), the `JoinError` code, the watch rejoin and the
  Player rejoin's Guest token.
- **`apps/web/test/watch.test.ts`** server-renders the real `Game`, `Lobby` and `JoinByCode` with
  the `zustand` `useStore` mock (SSR reads the initial store state), `#lib/use-media-query.ts` and
  `#board/Board.tsx` mocked, and the `window.location.origin` stub the invite card needs. A push
  with no events opens its gate at once, so the `awaitingRoll` view shows the Roll only for a
  Player.
- `apps/web/test/room-store.test.ts` has the role and `viewerOf` cases.
- **#253**: the Roll button has no `data-testid`; assert its absence by its label
  (`m.game_roll()`), or add the id there. The buy control is `data-testid="offer"`; there is no
  end-turn control (the engine passes the Turn).
