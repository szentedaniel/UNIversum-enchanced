# Ticket #35 (Guest token, Seat hold, reconnect): extension points and gotchas

Branch `ticket/35-reconnect`.

## Protocol (`packages/protocol/src/messages.ts`, `schemas.ts`)

- `guestToken?` in `CreateOptions` and `JoinOptions` (and both Zod schemas): 32 lowercase hex (`GUEST_TOKEN_PATTERN`). **Optional**: a client without one gets a Seat it can only regain by `reconnectionToken` (tests and #46 can omit it; the web always sends it).
- `LobbyMessage.seats` is `LobbySeatView[]` (`LobbySeat & { heldUntil?: number }`, server epoch ms; key absent when not held) and `LobbyMessage.now` (server clock, for the countdown).
- `CLOSE_CODE.seatTaken = 4100`: the server closes the old connection when the same Guest takes the Seat from another tab. The client must not try to win it back.

## Server (`apps/server/src/room/`)

- `guest-token.ts`: `guestTokenIn(options)` (validated or `null`), `hashGuestToken` (SHA-256 hex; 128-bit tokens need no scrypt).
- `SeatRecord` has `tokenHash: string | null`; stored as `StoredSeat.tokenHash` (optional on old rows → `null`). `publicView`/`LobbyMessage`/metadata never carry it (test: `reconnect.test.ts` "never reach another client").
- **Holds** (`#holds: Map<playerId, Hold>`, `Hold = { release, until, cancel }`):
  - `onDrop` → `allowReconnection(client, "manual")` + `hold(seat, () => reconnection.reject())`. A client that dropped before it answered the join handshake gets a rejected promise, not a `Deferred` (`reject` would throw), so its Seat is held with `release: null` for the Guest token to take back. Lobby: `until = now + LOBBY_SEAT_HOLD_MS` (60 s) via **`scheduler.at`** (so tests drive it with `ManualScheduler`); game: `until: null`, held until `endGame()` (`releaseHolds()`).
  - Lobby expiry → `release()` → Colyseus calls `onLeave` → `freeSeat`. Restored Lobby Seats have `release: null` and are freed directly.
  - `startGame` turns Lobby holds into game holds (no expiry): a game can start with an absent Player.
  - `onReconnect` → `unhold` + `sendCurrent` (game: one `game` message with `events: []` to that client; Lobby: `broadcastLobby`).
  - `takeBack(seat, client)` (Guest-token rejoin, in `onJoin` before the password check): swap `sessionId`, release the old hold, `leave(CLOSE_CODE.seatTaken)` an old connection still open, send `welcome` + current state. Old `onDrop`/`onLeave` find no Seat and do nothing.
  - `#shuttingDown`: `onDrop` does nothing (Colyseus calls `onLeave`, which also does nothing).
- `onAuth`: Guest-token match → admitted before the "game started" / full / password checks. Full check is now **`seats.length >= maxPlayers`** only.
- **`maxClients = maxPlayers * 2`**: a held Seat counts as a reserved client, so a Guest-token rejoin needs room.
- **Started and restored games are no longer `lock()`ed** (Colyseus would refuse `joinById` with 522 before `onAuth`). `unlist()` only unlists; `onAuth` (and `onJoin`) refuse everyone without a matching token with `ROOM_NOT_FOUND`. The `lock()` override is still there for the internal auto-lock.
- Restored Rooms: `autoDispose = false`. A restored Lobby holds each Seat 60 s (`hold(seat, null)`); once no restored hold is left (`waitIfRestored`), `autoDispose = true` (disposes 1 s later if empty → deleted).
- **#43 wired** (merged): `seat_drops_total` + "Seat dropped" in `onDrop` (Lobby and game) and in `onLeave` for a consented leave of a running game; `seatReconnected(seat)` in `onReconnect` and `takeBack`; "Seat freed" in `freeSeat`. `gauges().held` = Seats with no live client (dropped, or restored and not taken back). Test: `reconnect.test.ts` "observability". Logs carry `playerId` only, never the token, hash or `reconnectionToken`.
- **#37:** a forced close (flood) goes through `onDrop` → normal hold, as the spec asks; nothing extra needed.

## Tests

- `test/helpers.ts`: `newGuestToken()`, `TestClient.drop()` (non-consented close; SDK auto-reconnect is disabled on every TestClient), `server.reconnect(dropped)` (by `reconnectionToken`), `TestClient.received` (raw messages), `TestClient.closed` (close code).
- `test/reconnect.test.ts`: Lobby hold/countdown/reconnect, 60 s free, emptied Lobby deleted, Guest-token takeover (Lobby with password, game, second tab), wrong/no token refused, hold released at game end, restart rejoin, restored Lobby holds, no secrets.
- Colyseus' refusal of a stale reconnection token: `"reconnection token invalid or expired"`.

## Web (`apps/web/src`)

- `guest-token.ts`: `guestToken()` (localStorage `universum.guestToken`, in-memory fallback).
- `connection.ts`: create/join send the token. `listen(joined)` registers handlers (all guarded by `room === joined`). SDK reconnection: `maxRetries 8`, jittered `backoffDelay` (`lib/backoff.ts`). `onLeave`: `CONSENTED` → `lost`; `seatTaken` → `lost` + `takenElsewhere`; anything else → `rejoin()` by Guest token with back-off + jitter (INTERNAL = server down → retry forever; ROOM_NOT_FOUND retried 5 times, for a server still restoring). Store keeps the old view meanwhile; game pushes with a lower `version` are ignored.
- `roomStore`: `lobbyClockOffset`, `takenElsewhere`.
- `components/ReconnectOverlay.tsx` (in Lobby and Game): `data-testid="reconnect-overlay"`, "back to home" after 30 s (`BACK_HOME_AFTER_MS`), at once when `lost`.
- Lobby: held Seat → `SeatCard held={<HeldCountdown/>}` (`data-testid="seat-held"`, "Reconnecting 0:42").
- `Game` now calls `ensureJoined(code)` on open, so reloading `/game/:code` takes the Seat back.
- e2e: `apps/e2e/tests/reconnect.spec.ts` (Lobby close/reopen with held countdown; game `setOffline` + reopen). `context.setOffline(true)` does close the WebSocket in Chromium and WebKit. `window.universumTest.room()` declared in e2e `test-hooks.ts` (exists only once the Board is up: poll it).
