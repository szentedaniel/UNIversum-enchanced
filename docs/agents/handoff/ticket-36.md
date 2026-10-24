# Ticket #36 (Lobby list, create form, password Rooms): extension points and gotchas

Branch `ticket/36-lobby-list` (merged with v2-modernization incl. #25 and #42).

## Protocol (`packages/protocol/src/messages.ts`, `schemas.ts`)

- `LOBBY_ROOM = "lobby"`, `LOBBY_LIST_MESSAGE = { rooms, add: "+", remove: "-" }` (Colyseus LobbyRoom names).
- `LobbyListingMetadata` = `{ roomName: string | null, players, maxPlayers, minuteLimit, hasPassword }` is the GameRoom's Colyseus `metadata`; `LobbyListing` adds `code`. `roomName: null` = left empty, so the client shows `m.room_name_generated({code})` ("Room 123456"). The server never sends a generated text name.
- `LobbyMessage` gained `roomName`, `hasPassword`.
- `CreateOptions` = settings + `roomName?`, `password?`. **`JoinOptions` = `{ code, password? }`**: the client repeats the Room code because static `onAuth` gets no Room. #35 adds `guestToken` to `joinOptionsSchema` (a `z.object`, so unknown keys are stripped).
- `PASSWORD_MAX_BYTES = 64`, `utf8Length(text)` (Zod-free, so the web can use it).
- Rejection codes added: `ROOM_FULL`, `ROOM_NAME_INVALID`, `WRONG_PASSWORD`. #37 adds `ROOM_NAME_BLOCKED`, `PASSWORD_LOCKED`, `RATE_LIMITED`, `SERVER_BUSY` (with `retryAfter`, which `matchmakeRejection` doesn't carry yet).
- **`matchmakeRejection(MatchMakeError)`**: maps a failed create/join to a Rejection code. The server throws `new ServerError(httpStatus, RejectionCode)`, so the message _is_ the code; Colyseus's own 522 (unknown or locked Room) becomes `ROOM_NOT_FOUND`; anything else `INTERNAL`. To return JSON (`retryAfter`) in #37, extend this one function.

## Server (`apps/server/src/room/`)

- `room-name.ts` `checkRoomName(raw) → {ok:true,name:string|null} | {ok:false}`: NFKC → reject Default_Ignorable + bidi → trim/collapse → empty = `null` → ≤ 96 bytes → allowlist `A-Za-z0-9 áéíóöőúüűäß ÁÉÍÓÖŐÚÜŰÄ space - _ . , ! ? ' &` → 3–24 graphemes. **#37: the word filter goes after the allowlist**, returning a new `{ok:false, code:"ROOM_NAME_BLOCKED"}` shape (callers in `GameRoom.onCreate`). Tests: `apps/server/test/room-name.test.ts` (table-driven).
- `password.ts`: `hashPassword` (scrypt, node:crypto defaults, 16-byte salt, 64-byte key), `passwordMatches` (timingSafeEqual). The hash lives on the Room instance (`GameRoom.password`); **#34 must store `{salt, hash}`** and restore it.
- `GameRoom`:
  - Field **`displayName`** holds the Room name. Don't call it `roomName`: Colyseus's `Room.roomName` is the handler name ("game"), and shadowing it breaks the matchmaker (`handlers[room.roomName]` → undefined).
  - **static `onAuth(token, options)`**: if the options parse as join options, it looks up `matchMaker.getLocalRoomById(code)` (single-process), then 404 `ROOM_NOT_FOUND` (missing or game started), 409 `ROOM_FULL` (`hasReachedMaxClients()`, counts reservations), 403 `WRONG_PASSWORD`. Then it returns `{ code }` as `client.auth`. Anything else counts as a create → `true`. **#37's limiter goes at the top of onAuth** (before scrypt). #35's Guest-token rejoin also passes here: a running game returns ROOM_NOT_FOUND, so #35 must let a token holder through.
  - `onJoin` is async: a client without `auth.code === this.roomId` (the creator, or someone who sent create-shaped options to joinById) must carry the right `password` in its options (the creator's create options do).
  - **`lock()` override**: Colyseus auto-locks a full Room (`lock(true)`), and then `joinById` fails with 522 _before_ onAuth. That would make "full" look like "not found", so internal locks are ignored; `maxClients` still caps Seats at reservation (a lost race → SeatReservationError 523 → `INTERNAL`). An explicit `this.lock()` still locks (game start). If #35 raises `maxClients` above the Seat count, ROOM_FULL must use `seats.length` instead.
  - Listing: `this.metadata = this.listing()` in onCreate, then `setMetadata(this.listing())` in `broadcastLobby()` (every Seat change).
  - **Unlisting on start** (`unlist()`): `updateLobby(this, true)` first (sends `-`), then `setMatchmaking({ unlisted: true })` and `lock()`. Order matters: once a Room is unlisted, `updateLobby` returns early. The private flag is never used.
- `server.ts`: game Room defined with `.enableRealtimeListing()`; `LOBBY_ROOM` = Colyseus `LobbyRoom` (sends the whole IRoomCache, so **never put secrets in metadata**).
- Tests: `apps/server/test/lobby-list.test.ts`; helpers: `server.join(code, { password })` (adds `code`), `server.watchLobbyList()` → `TestLobbyList` (`get(code)`, `until(pred)`, `received` raw messages for the no-secrets check).

## Web (`apps/web/src`)

- Routes: `/rooms` `screens/LobbyList.tsx`, `/create` `screens/CreateRoom.tsx`. Home now links to both, and the `/?players=&minutes=` query is gone (e2e uses `/create`).
- `connection.ts`: `joinRoom(code, password?)`, `createRoom(options)`, `watchLobbyList(onChange) → stop` (separate SDK Room, not in `roomStore`; StrictMode-safe). `JoinError.code` comes from `matchmakeRejection`.
- `screens/join.tsx`: `useJoin()` (`{code, asking, error, busy, join(code, pw?), ask(code)}`; a WRONG_PASSWORD with no password given becomes "ask", not an error), `PasswordForm`, `RejectionText`, `JoinByCode` (Home + list). #37's `retryAfter` countdown would disable these buttons.
- `Lobby.tsx`: opening a password Room's address shows the password prompt. Settings shown (Players, Minute limit, password yes/no); back link → `/rooms`.
- Markup is plain and semantic (`.lobby-list` grid 1/2/3 columns at 640/960 px, `.lobby-tile`, `.create-form`, `.password`, `.settings`, `a.button`), CSS appended at the end of `styles.css` for #40 to restyle. The lock is `<p class="lock"><span aria-hidden>🔒</span> Password</p>`.
- e2e: `apps/e2e/tests/lobby-list.spec.ts` (per project; extra Guests via `browser.newContext({ baseURL, locale: "en-US" })`).
