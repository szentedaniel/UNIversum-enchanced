# Ticket #37 (Abuse protections): extension points and gotchas

Branch `ticket/37-abuse` (merged with v2-modernization at 1034d09, incl. #34 store, #27, #28).

## Config

- `apps/server/src/limits.ts`: `DEFAULT_LIMITS` (spec values) + `loadLimits(env)`; env name = `LIMIT_` + key in SCREAMING_SNAKE (`limitEnvName`), e.g. `LIMIT_JOINS_PER_MINUTE`. `config.limits`; `createGameServer({ store, limits })` (defaults when omitted). Listed in `.env.example`.
- **#46 load test**: raise only the per-IP ones (`LIMIT_ROOM_CREATIONS_PER_MINUTE/_PER_HOUR`, `LIMIT_OPEN_LOBBIES_PER_IP`, `LIMIT_JOINS_PER_MINUTE`, `LIMIT_SEAT_RESERVATIONS_PER_IP`, `LIMIT_SOCKETS_PER_IP`, `LIMIT_PASSWORD_FAILURES_PER_IP`); e2e does exactly this in `playwright.config.ts` (`PER_IP_LIMITS`). Server tests: `TEST_LIMITS` in `test/helpers.ts` (same idea), `startTestServer({ limits })` to lower any.

## Where each limit lives (`apps/server/src/abuse/`)

- `guard.ts` `AbuseGuard` (one per server, all `rate-limiter-flexible` memory + Maps): request rates, sockets, Seat reservations, live Lobbies, password throttle.
- `gated-http.ts` `createGatedHttpServer(guard)`: the transport's `node:http` server with `emit` intercepted, so the gate runs before Colyseus's own listeners. Per `POST /matchmake/*`: creation (`create/game`) and join (`joinById/*`, `join|joinOrCreate/game`) rates — here because Colyseus answers an unknown Room code (522) **before** onAuth, and wrong codes must count; body ≤ `matchmakeBodyBytes` (413 MALFORMED; body handed on as `req.body`); sets `X-Real-IP` from the socket when no proxy header (Colyseus's matchmaking onAuth context has no socket fallback); sets `x-universum-request` (`REQUEST_ID_HEADER`) = the request's reservation id, and a non-2xx response frees that reservation. Counts open sockets on `'upgrade'` (decrement on socket close); `beforeUpgrade` in `server.ts` refuses over `socketsPerIp` (429).
- `GameRoom.authorize(guard, options, context)` is the static onAuth (bound in `createGameServer`'s subclass). Method from `context.req.url`: `create` → live-Lobby cap (`SERVER_BUSY`), open Lobbies per IP, reservations per IP; `joinById` → must parse as join options (else MALFORMED — closes the create-options-via-joinById bypass), reservations, ROOM_NOT_FOUND/ROOM_FULL, then password: empty → WRONG_PASSWORD uncounted; `guard.passwordAttempt` (consumes before scrypt) → `PASSWORD_LOCKED`+retryAfter; wrong → `passwordFailed` (5th failure blocks `60·2^(n-1)` s, max 3600); right → `passwordMatched`. Returns `client.auth = SeatAuth { bucket, reservation, creates, code? }`. **#35: a Guest-token rejoin via joinById passes here; a running game answers ROOM_NOT_FOUND — let token holders through before that check.** `reconnect` doesn't call onAuth.
- `onJoin` releases the reservation; the creator's first Seat attributes the Lobby to its IP (`lobbyCreatedBy`). `lobbyOpened` in onCreate (also restored Lobbies), `lobbyClosed` in `unlist()` (start) and onDispose.
- Refusals: `refuse(Refusal | code)` in game-room.ts with `STATUS` map; message = `refusalMessage()` (protocol): bare code, or JSON `{code,retryAfter}`. Client: `matchmakeRefusal(error)` → `{code, retryAfter?}` (`matchmakeRejection` kept).
- IP: `abuse/ip.ts` `clientIp` (X-Real-IP → XFF first → X-Client-IP → socket), `ipBucket` (IPv4, IPv6 /64, `unknown`).

## Intents

- `abuse/flood.ts` `FloodMeter` per sessionId (`GameRoom.#flood`, deleted in onLeave), real clock (`performance.now()`), applied to `intent` and `"*"` messages via `admit()`. Over 10/s: dropped, first with `SLOW_DOWN`; close after 5 s over or >50 in a second: `client.leave(CloseCode.WITH_ERROR)` → goes to **onDrop** when defined (else onLeave). **#35: your onDrop Seat hold covers flood closes; don't treat 4002 as consented.** Today a running game keeps the Seat (onLeave returns early); a Lobby frees it until #35.
- `seatReservationTimeout` = `limits.seatReservationSeconds` (5) set in onCreate. WS `maxPayload` = 1024 (closes 1009).

## Room name filter

- `room/word-filter.ts` (`hasBlockedWord`, `fold`): whole words/phrases on NFD-stripped lowercase (ß→ss); `ADDED` hu/de words, `STEMS` (prefix match), `ALLOWED` (Scunthorpe whitelist, words and phrases). `room/blocked-words.ts`: LDNOOBW seed (CC BY 4.0, attribution in file + README "Third-party content") minus `REMOVED_FROM_SEED`. `checkRoomName` → `{ok:false, code:"ROOM_NAME_INVALID"|"ROOM_NAME_BLOCKED"}`.

## Web

- New Rejection codes in `text.ts` + messages: `ROOM_NAME_BLOCKED`, `PASSWORD_LOCKED`, `RATE_LIMITED`, `SERVER_BUSY`, `SLOW_DOWN`; `retry_in({seconds})`.
- `JoinError.retryAfter`; `screens/join.tsx`: `useCountdown(until)`, `retryAtOf(error)`, `waitLabel(wait, label)`; `useJoin()` returns `wait`; `PasswordForm wait`, `RejectionText wait` (Lobby address error page). Buttons disabled with "Try again in N s" (Join by code, Lobby list tiles, password form, Create).
- `RejectionMessage` has optional `retryAfter` (in-game toast ignores it).

## Tests

- `test/abuse.test.ts` (rates, IPv6 /64, reservations, open Lobbies, passwords, body/payload sizes, flood with Seat kept), `test/capacity.test.ts` (Lobby cap, sockets/IP), `test/guard.test.ts` (hour limit, back-off doubling, reservation lapse; fake timers), `test/flood.test.ts`, `test/ip.test.ts`, `room-name.test.ts` (filter + Scunthorpe), `packages/protocol/test/refusal.test.ts`. Helpers: `server.from(ip)` (SDK with X-Real-IP; WS still from 127.0.0.1), `server.matchmake(path, body, {ip, rawBody})` (raw POST, never connects), `server.port`.
- e2e `tests/abuse.spec.ts`: blocked name inline; 5 wrong passwords → PASSWORD_LOCKED + disabled "Try again in 60 s".
