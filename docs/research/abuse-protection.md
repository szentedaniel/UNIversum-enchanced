# Research: abuse protection for a public Colyseus game

Ticket: #17 (part of map #1). Feeds Decide the v2 abuse protections (#19). Researched on **2026-10-18**. Every version number below is as of that date. Check them again before implementation.

## Question

How does a public, browser-based game on the chosen stack (self-hosted Colyseus 0.18 on Node 26, Caddy in front, docker compose, $0, provider-independent; see ADR-0002) protect itself from abuse? Five areas: rate limiting, the cost of a Guest identity, username filtering, password Rooms, and the cost of validating intents. This note reports options with trade-offs. It does not decide.

## Versions checked

From the npm registry and GitHub on 2026-10-18 [npm]: `@colyseus/core` 0.18.19 (2026-10-16), `colyseus` 0.18.9, `@colyseus/ws-transport` 0.18.4, `ws` 8.22.0, `zod` 4.6.7, Caddy 2.11.7 (2026-10-03) [caddy-release], `altcha` 3.4.0 / `altcha-lib` 2.6.0, `@cap.js/widget` 0.1.58, `@cap.js/server` 4.0.5 (2025-12-14), `rate-limiter-flexible` 11.2.3, `obscenity` 0.4.6, `glin-profanity` 3.3.0, `@2toad/profanity` 3.3.0, `naughty-words` 1.2.0 (2020). All Colyseus facts below come from the `@colyseus/core` 0.18.19 and `@colyseus/ws-transport` 0.18.4 source in the npm tarballs, unless a docs page is cited.

## What v1 does today (baseline)

- **No limits anywhere.** v1 has no rate limiting, no message size limit beyond Socket.IO defaults, and no input validation. `set_username` stores whatever the client sends (`server/index.ts:50`).
- **Usernames are generated, not typed.** The client picks a random "adjective noun" name from built-in hu/en word lists (`client/src/randomName.js`, used in `client/src/Store/slices/userSlice.js:12`). The Lobby screen only displays it (`client/src/Components/LobbyComponent/Lobby.jsx:61`). There is no rename UI. **So at feature parity the only free text a Guest types is the Lobby (Room) name and the Room password.** A modified client can still send any name, because the server trusts it.
- **Room name and password:** free text with no length limit (`client/src/Components/CreateLobbyComponent/CreateLobby.jsx`). The password is hashed with `bcrypt.hashSync` using one process-wide salt, checked with `compareSync` (both block the event loop), and the plaintext is logged on every join (`server/roomSystem.ts:14`, `:81-82`).

This matters for #19: a username filter may not be needed at all if v2 keeps server-generated names. The Room name, which every Guest sees in the Lobby list, is the surface that needs rules.

---

## Area 1: Rate limiting

### What Colyseus 0.18 gives natively

| Mechanism | What it does | Default |
|---|---|---|
| `Room.maxMessagesPerSecond` | Counts messages per client in a fixed 1 s window. Over the limit, the client is **forcibly closed** with code 4002 (`WITH_ERROR`) [colyseus-room-src `_onMessage`; colyseus-room-docs] | `Infinity` (off) |
| `maxPayload` (ws transport) | Largest single WebSocket message a client may send. `ws` closes the socket with 1009 when exceeded [ws-receiver] | **4096 bytes** in Colyseus (`ws` alone defaults to 100 MiB) [colyseus-ws-src; colyseus-ws-docs] |
| Static `onAuth(token, options, context)` | Runs at HTTP matchmaking time for `create`, `join`, `joinOrCreate` and `joinById`, before a seat is reserved. `context.ip` and `context.headers` are available; on the HTTP path `context.req` is the `Request` itself, so the method and Room code can be read from the URL. A thrown `ServerError` reaches the client [colyseus-auth-docs; colyseus-matchmaker-src] | returns `true` |
| Instance `onAuth(client, options, context)` | Runs when the WebSocket connects, **after** the seat was reserved over HTTP. Can read Room state [colyseus-auth-docs; colyseus-room-src `_onJoin`] | — |
| `beforeUpgrade(req, context)` (ws transport) | Runs before the WebSocket handshake; returning a `Response` refuses the upgrade [colyseus-ws-docs] | — |
| `validate(schema, handler)` / `onMessage(type, schema, handler)` | Standard Schema (Zod) validation of a message before the handler. **On failure the client is disconnected with 4002**; a request-style message gets an error reply instead [colyseus-room-docs; colyseus-messages-src] | — |
| Unknown message type | In production the client is disconnected; in dev mode it gets an error [colyseus-messages-src `#noHandler`] | — |
| `seatReservationTimeout` | How long a reserved seat waits for the WebSocket | 15 s (`COLYSEUS_SEAT_RESERVATION_TIME`) |
| Matchmaking body size | `POST /matchmake/...` bodies over 1 MiB are refused [colyseus-router-node-src] | 1 MiB |
| `matchMaker.controller.exposedMethods` | Which matchmaking methods HTTP may call | `joinOrCreate, create, join, joinById, reconnect` |

**Nothing counts joins or Room creations per IP, per Guest or globally.** That part is custom. Colyseus has no rate-limit plugin; the 0.18 `RoomPlugin` hooks (`onCreate`/`onAuth`/`onJoin` run before the Room's own) are a place to put one [colyseus-plugin-src].

**The old recipe no longer applies.** The 0.11 docs recommended `express-rate-limit` on `app.use("/matchmake/", …)` with `trust proxy` [colyseus-011-ratelimit]. In 0.18 the matchmaking route is served by Colyseus's own router, which checks its routes **before** handing the request to Express (`router/index.ts`, `bindRouterToTransport`). Express middleware never sees `/matchmake/*`. In-process limits on matchmaking therefore belong in static `onAuth` (or a `RoomPlugin`).

### Three findings that shape the design

1. **Seat squatting.** A seat is reserved at HTTP time and counts toward `maxClients` (`hasReachedMaxClients` adds reserved seats) until the WebSocket arrives or 15 s pass [colyseus-room-src `_reserveSeat`]. Four `POST /matchmake/joinById/<code>` calls without ever connecting fill a 4-Player Lobby for 15 s, and a loop keeps it full. Only checks in **static** `onAuth` run before the reservation. A shorter `seatReservationTimeout` and a per-IP cap on outstanding reservations both narrow it.
2. **Spoofable client IP.** Colyseus takes the client address from the first entry of `X-Real-IP`, then `X-Forwarded-For`, then `X-Client-IP`, and only then the socket address [colyseus-transport-src `resolveClientIp`]. Caddy's `reverse_proxy` ignores incoming `X-Forwarded-*` from untrusted clients and sets its own [caddy-reverse-proxy; caddy-src `addForwardedHeaders`], but it **passes `X-Real-IP` and `X-Client-IP` through untouched**. A client that sends `X-Real-IP: 1.2.3.4` through a stock Caddy config picks its own IP for every limit. The Caddyfile needs `header_up X-Real-IP {remote_host}` (and `header_up -X-Client-IP`), and the Node port must not be published outside the compose network.
3. **Disconnecting is a speed bump.** A client closed for flooding or an invalid payload leaves with 4002, which goes through `onDrop` (not `onLeave`) [colyseus-room-src `_onLeave`]. ADR-0002's Seat hold (`allowReconnection(client, "manual")`) then keeps the Seat, and the Guest reconnects with its Guest token. Whether a forced close also forfeits the Seat, or only after N closes, is a Room decision.

### Caddy per-IP limits

- **Not in the stock image.** `http.handlers.rate_limit` is a non-standard module: "This module does not come with Caddy. It can be added by using xcaddy" [caddy-module-ratelimit]. It is `mholt/caddy-ratelimit` (Apache-2.0, not an official Caddy-org repo, last commit 2026-06-12, only tag v0.1.0 from 2025-01-06, so a build pins a commit) [caddy-ratelimit].
- **Custom build cost:** the official image documents a two-stage build: `FROM caddy:2.11.7-builder` → `xcaddy build --with github.com/mholt/caddy-ratelimit@<commit>` → copy `/usr/bin/caddy` onto `caddy:2.11.7` [caddy-docker]. That fits the single Dockerfile with a Caddy `web` target from #12, as one more stage.
- **What it does:** sliding-window zones keyed by any placeholder (e.g. `{http.request.remote.host}`), request matchers per zone (so `/matchmake/create/*` and `/matchmake/joinById/*` can have different limits), `ipv6_prefix` to bucket a /64 as one key, `Retry-After` set automatically, HTTP 429 on reject, and optional distributed state via shared storage for multi-server [caddy-ratelimit].
- **What it does not do:** it counts requests, so a WebSocket upgrade is one event; it cannot see messages inside the socket or count concurrent sockets per IP. State is lost on restart (persisting it is "planned") [caddy-ratelimit]. Also, a Caddy config reload closes every WebSocket unless `stream_close_delay` is set [caddy-reverse-proxy].
- **Without the module**, stock Caddy can only refuse by matcher (e.g. a `remote_ip` blocklist). Per-IP counting then lives in Node.

### Node-side limiter

`rate-limiter-flexible` 11.2.3 (ISC): memory, cluster, Redis/Valkey, SQLite and PostgreSQL stores, with atomic increments; the memory store supports `dump()`/`restore()` across restarts [rlf-readme]. A memory limiter is enough for one server; the Redis store matches the Redis presence ADR-0002 plans for 10×. Hand-rolled fixed-window `Map` counters also work for a handful of keys.

### Where each limit can live

| Limit | Caddy (`rate_limit`) | Static `onAuth` | Room (`onMessage`) |
|---|---|---|---|
| Room creations per IP | ✓ by path matcher | ✓ by `context.req` URL | — |
| Joins / `joinById` attempts per IP | ✓ | ✓ | — |
| Outstanding seat reservations per IP | — | ✓ (custom counter) | — |
| WebSocket upgrades per IP | ✓ (rate only) | — | `beforeUpgrade` for concurrent count |
| Global cap on live Lobbies | — | ✓ | — |
| Intents per connection | — | — | `maxMessagesPerSecond` (disconnect) or custom (Reject) |
| Survives restart | ✗ | memory ✗ / SQLite ✓ | n/a |
| Error the Player sees | HTTP 429 (generic) | `ServerError` code → client message | Rejection or close code |

Trade-off: Caddy limits are cheap and stop traffic before Node, but need a custom build and give the client only a bare 429. `onAuth` limits need no new infrastructure and can return a specific code the client maps to a translated message, but every request still costs Node a little.

---

## Area 2: The cost of an identity, and what to key limits on

A Guest token is 128 random bits the browser makes itself (#9). Per-Guest limits are evaded by clearing `localStorage`. The usable keys:

| Key | Cost to evade | Collateral damage |
|---|---|---|
| Guest token | zero | none |
| Connection / session | zero (reconnect) | none |
| IPv4 address | needs more IPs (proxies, VPN) | **shared IPs**: a university's eduroam, a school or a mobile carrier's CGNAT (RFC 6598 shared address space) puts many real Players behind one address. This game has a university theme, so classroom-sized groups on one IP are a realistic peak |
| IPv6 /64 | needs more /64s | small; a single address is too fine because one host gets a whole /64 [caddy-ratelimit `ipv6_prefix`] |
| Proof-of-work per action | CPU seconds per action | latency and battery on old phones |

**What comparable games key on:**
- **Lichess** (open source, anonymous play allowed) keys its anonymous game-creation limits on **IP**: `setupPost` 5 per minute per IP, and anonymous seeks ("hooks") a composite of 8 per minute and 300 per day per IP [lichess-limiters, `Setup.scala`]. It keys on user id only for logged-in users. Lichess is the closest open comparable to a Lobby list of anonymous Rooms.
- **boardgame.io** has **no** rate limiting. Its server offers only CORS `origins` and a Lobby API body limit (`apiBodyLimit`, default 5 MB); its last npm release is 0.50.2 from 2022-11-10 [bgio-server-src; npm].
- **skribbl.io, Gartic Phone** are closed source. I could not establish what they key on from a primary source.

**Self-hosted proof-of-work (no provider CAPTCHA):**

| Option | Licence | Runs as | Server needs | Notes |
|---|---|---|---|---|
| **ALTCHA** (`altcha` widget 3.4.0 + `altcha-lib` 2.6.0) | MIT | a library in our Node server | none; HMAC secret | v2 challenge format supports SHA, PBKDF2, scrypt and Argon2id (native in Node 24.7+), `expiresAt`, and a Store to stop replay of a solved challenge [altcha-lib-readme]. Fits "one process, no extra service" |
| **Cap** (`@cap.js/widget` 0.1.58) | Apache-2.0 | a standalone Docker service with a REST API and dashboard | **Valkey/Redis** [cap-guide] | "gpu-resistant proof-of-work and instrumentation" [cap-readme]. An extra container; the `@cap.js/server` library's last release is 2025-12-14 and the docs only describe the standalone server |
| **mCaptcha** | **AGPL-3.0** | Rust server | PostgreSQL + its own cache image [mcaptcha-compose] | last commit 2025-10-07, last release v0.1.0 (2024-03). Heavy and copyleft for this use |

Trade-offs: PoW raises the price of each Room creation, not of the identity, and a determined attacker on server hardware pays far less than a phone does. It is most useful on the one action that creates server state (Room creation), and least useful on every join, where it adds visible delay for every Player. Its cost per challenge on low-end phones was not measured here.

---

## Area 3: Username and Room name filtering

### Word lists for hu / en / de

| Library / list | Licence | hu | en | de | Notes |
|---|---|---|---|---|---|
| **LDNOOBW** (`naughty-words` 1.2.0) | CC-BY-4.0 | 96 | 403 | 66 | plain JSON per language; repo last pushed 2024-08, npm 2020 [ldnoobw; npm]. Attribution required |
| **glin-profanity** 3.3.0 | MIT in README, ISC in `package.json` (inconsistent) | ✓ | ✓ | ✓ | 23 languages, leetspeak levels, `normalizeUnicode`, whitelist [glin-readme]. Its hu list has 96 entries, 64 of them identical to LDNOOBW's |
| **obscenity** 0.4.6 | MIT | ✗ | ✓ | ✗ | English only. Strong matching: confusables, leetspeak, word-boundary and whitelist rules; does not match "pen is", "bananas so", "banal", "grapes" [obscenity-readme] |
| **@2toad/profanity** 3.3.0 | MIT | **✗** | ✓ | ✓ | translations are produced with Argos Translate (machine translation) [2toad-langs] |
| `bad-words`, `leo-profanity` | MIT | ✗ | ✓ | ✗ | English only |
| `better-profane-words` | **GPL-3.0** | | | | copyleft |

No maintained offline list covers **Hungarian** well. The LDNOOBW Hungarian file is mostly inflections of about twenty swear words; it has **no** slurs such as "buzi" or "köcsög" and not "bazdmeg" (it has "bazmeg"). The German file lacks "Schwanz", "Spast", "Missgeburt", "Nazi" and "Hitler". Any hu/de filter needs a hand-curated addition [measured against `naughty-words` 1.2.0].

### False positives (Scunthorpe problem)

Plain substring matching on LDNOOBW, measured on its own lists:

- **en** (50 entries of 4 characters or fewer): Scunthorpe → `cunt`, Cassandra → `ass`, Essex/Sussex → `sex`, Dickens → `dick`, cocktail/Hancock → `cock`, grape → `rape`, therapist → `rapist`, Penistone → `penis`.
- **hu** (11 short entries, e.g. `kúr`, `pele`, `fing`, `búr`, `szar`): kúra and Kúria → `kúr`, pelenka → `pele`, Búra → `búr`, fingerprint → `fing`.
- **de**: Barsch (perch) → `arsch`, Mösenbach → `möse`.

Hungarian is agglutinative, so whole-word matching misses inflected forms (the list itself has to spell out `faszt`, `faszok`, `faszokat`…), while substring matching produces the hits above. The options:

- **Reject on match** (the Player retypes): honest, but a false positive blocks a legitimate name with no way around it.
- **Mask on match** (`***`): never blocks, but shows that something was hidden, and a Room name full of stars still reaches every Guest's Lobby list.
- **Whole-word plus a curated stem list plus a whitelist:** fewest false positives; the lists are ours to maintain in three languages.
- **No filter, but no free text:** keep v1's generated Player names on the server and filter only the Room name; or offer generated Room names too. Smallest surface. It loses the free-text Lobby name v1 has, which feature parity may not allow.

### Unicode tricks

Primary rule source: UTS #39 Unicode Security Mechanisms, version 18.0.0, 2026-08-27 [uts39].

- **Normalise first.** NFC (or NFKC, which also folds full-width and stylistic letters such as `𝐟` to `f`) before checking length or words. Node has `String.prototype.normalize`.
- **Invisible characters.** UTS #39 lists `Default_Ignorable_Code_Point` characters as Restricted for identifiers. That covers zero-width space/joiners (U+200B–200D), word joiner (U+2060), BOM (U+FEFF) and soft hyphen. Strip or reject them; in JS, `/\p{Default_Ignorable_Code_Point}/u`.
- **Bidi controls** (U+202A–202E, U+2066–2069; the "Trojan Source" class) can reverse how a name renders next to other text. UTS #39's email profile forbids stateful bidi format characters [uts39]. Reject them.
- **Homoglyphs.** UTS #39 defines `skeleton(X)`: NFD, remove default-ignorables, map each character to its confusable prototype, NFD again [uts39]. Comparing skeletons catches Cyrillic `а` for Latin `a` (both in a word filter and in two Players with lookalike names). The simpler option is an **allowlist**: Latin letters (which covers á é í ó ö ő ú ü ű ä ß), digits, space and a few punctuation marks, which removes mixed-script homoglyphs without a confusables table.
- **Length.** Count grapheme clusters with `Intl.Segmenter`, not `.length` (UTF-16 units). Cap bytes as well, because one grapheme can carry many combining marks ("Zalgo text").

---

## Area 4: Password Rooms

- **The attack.** Guessing a Lobby password means one `POST /matchmake/joinById/<code>` per guess. If the check runs in the **instance** `onAuth`, every guess also reserves a seat first (Area 1, finding 1) and needs a WebSocket. If it runs in **static** `onAuth`, the Room code can be read from `context.req`'s URL and the scrypt hash fetched from the `RoomStore`, so a wrong guess costs no seat.
- **Hash cost is itself a DoS lever.** Measured on Node 26.11.1 (Apple M3): `crypto.scrypt` with Node's defaults (N=16384, r=8, p=1, 16 MiB) takes **22.7 ms** per hash; OWASP's first recommendation (N=2^17, 128 MiB) takes **193 ms** [measured; owasp-password]. Async scrypt runs on the libuv pool, 4 threads by default (`UV_THREADPOOL_SIZE`), which gives **about 150 checks per second for the whole server** at default cost. A flood of guesses saturates that pool and delays every other password join. `scryptSync` would block the event loop instead (v1's `bcrypt.compareSync` already does). So the attempt limit must come before the hash.
- **How others throttle.** OWASP: lockout needs a threshold, an observation window and a duration; exponential back-off is an alternative to a fixed lockout; and "care must be taken to prevent it from being used to cause a denial of service by locking out other users' accounts" [owasp-auth]. `rate-limiter-flexible`'s login example pairs a slow per-IP limiter (100 per day) with a per-(username + IP) consecutive-failure limiter (10, then a 1 h block), instead of per-username alone, because per-username lets an attacker lock a victim out [rlf-wiki].
- **Applied to a Lobby:** key failures on (Room code + IP) for the targeted case and on IP for spraying across Rooms. A per-Room lockout (all IPs) is simplest but lets one attacker lock the real friends out of their own Lobby, which is exactly OWASP's DoS warning. A Lobby lives minutes, so even 5 tries per minute per (code + IP) puts any reasonable password out of reach.
- **Room codes.** Guessing codes with `joinById` finds only Lobbies that are already on the Lobby list (started Rooms are locked), so code enumeration leaks little. It still costs a seat reservation per hit, so the same per-IP `joinById` limit covers it.

---

## Area 5: Message validation cost and size limits

**Zod 4 is not a DoS concern at this scale.** Measured on Node 26.11.1 / Apple M3 with `zod` 4.6.7, using a 12-variant `discriminatedUnion` intent schema shaped like v2's:

| Operation | µs per op | ops/s per core |
|---|---|---|
| `safeParse` valid `sell` intent (7 Field ids) | 0.63 | ~1.6 M |
| `safeParse` unknown `type` | 0.43 | ~2.3 M |
| `safeParse` 1,300-element array (over `max(32)`) | 0.42 | ~2.4 M |
| `safeParse` 400-level nested object | 0.39 | ~2.6 M |
| `msgpackr.unpack` of a 30-byte intent | 0.15 | ~6.9 M |
| `msgpackr.unpack` of a 1.3 KB junk array | 6.1 | ~164 k |

At ~4,000 Players sending even 10 intents per second each (far above real play), validation is about 25 ms of CPU per second, about 2.5 % of one core. The 4 KB `maxPayload` bounds the worst-case decode at a few microseconds. The expensive steps are elsewhere: the scrypt check (Area 4) and the synchronous SQLite write after every **accepted** intent (#9). Rejected intents write nothing.

**What happens to a bad message today vs. what v2 may want:**

| Case | Colyseus default | Alternative |
|---|---|---|
| Message > `maxPayload` (4 KB) | `ws` closes the socket (1009) | lower `maxPayload` (an intent is tens of bytes; the Lobby name is the largest input) |
| Over `maxMessagesPerSecond` | close 4002 → `onDrop` | own counter in the handler: drop silently, or send a Rejection, then close after a threshold |
| Fails the `validate()` schema | close 4002 | register without a schema, `safeParse` in one `"intent"` handler, send a Rejection code the client shows as a message |
| Unknown message type | close in production | one wildcard/`"intent"` handler, so there is no unknown type |
| Valid shape, illegal move | n/a | `apply()` returns a Rejection (ADR-0003) |

A client that disconnects on every malformed message is easy to reason about, but a client bug then looks like a network drop and, with the Seat hold, the Player just reconnects. Rejections keep the Player in the game and let the UI say why.

---

## Open questions for Decide the v2 abuse protections (#19)

- Free text or generated names: keep v1's generated Player names (made on the server), and is the Lobby name the only free text that needs filtering?
- Caddy custom build with `caddy-ratelimit` (pinned commit), or all limits in Node (`onAuth` + an in-memory or SQLite limiter)?
- Key choice: IP (IPv6 /64) with limits generous enough for a campus NAT, or IP plus PoW on Room creation only?
- Values for Room creations, `joinById` attempts and outstanding seat reservations per IP; a global cap on live Lobbies; `seatReservationTimeout` shorter than 15 s?
- Password checks in static `onAuth` (no seat reserved), keyed on (code + IP) and IP; scrypt cost vs. checks per second.
- Invalid or flooding intents: Rejection, silent drop, or disconnect; and does a forced close forfeit the Seat?
- Caddyfile must override `X-Real-IP` and strip `X-Client-IP`; is the Node port kept off the host network?

---

## Sources

- [npm] npm registry, `https://registry.npmjs.org/<package>` dist-tags, `time` and `license`, read 2026-10-18.
- [colyseus-room-src] `@colyseus/core` 0.18.19 `src/Room.ts` (`maxMessagesPerSecond`, `_onMessage`, `_reserveSeat`, `_onJoin`, `_onLeave`, `seatReservationTimeout`, `hasReachedMaxClients`): https://github.com/colyseus/colyseus/blob/master/packages/core/src/Room.ts
- [colyseus-messages-src] `@colyseus/core` 0.18.19 `src/RoomMessages.ts` (`onData`, `#noHandler`).
- [colyseus-matchmaker-src] `@colyseus/core` 0.18.19 `src/MatchMaker.ts` (`create`, `join`, `joinById`, `reconnect`, `callOnAuth`) and `src/matchmaker/controller.ts` (`exposedMethods`, CORS defaults).
- [colyseus-transport-src] `@colyseus/core` 0.18.19 `src/Transport.ts` (`createAuthContext`, `resolveClientIp`).
- [colyseus-router-node-src] `@colyseus/core` 0.18.19 `src/router/node.ts` (`MAX_BODY_SIZE`) and `src/router/index.ts` (`bindRouterToTransport`).
- [colyseus-plugin-src] `@colyseus/core` 0.18.19 `src/RoomPlugin.ts`.
- [colyseus-ws-src] `@colyseus/ws-transport` 0.18.4 `src/WebSocketTransport.ts` (`maxPayload` 4 KB, `perMessageDeflate` off, `beforeUpgrade`).
- [colyseus-room-docs] Colyseus 0.18 Room docs: https://docs.colyseus.io/room
- [colyseus-auth-docs] Colyseus 0.18 Room authentication: https://docs.colyseus.io/auth/room
- [colyseus-ws-docs] Colyseus WebSocket transport: https://docs.colyseus.io/server/transport/ws
- [colyseus-011-ratelimit] Colyseus 0.11 "rate limit" how-to: https://0-11-x.docs.colyseus.io/how-to/rate-limit/
- [ws-receiver] `ws` 8.22.0 `lib/receiver.js` (1009 "Max payload size exceeded") and `lib/websocket-server.js` (default 100 MiB).
- [caddy-release] Caddy releases: https://github.com/caddyserver/caddy/releases (v2.11.7, 2026-10-03)
- [caddy-reverse-proxy] Caddy `reverse_proxy` directive: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
- [caddy-src] Caddy v2.11.7 `modules/caddyhttp/reverseproxy/reverseproxy.go` (`addForwardedHeaders`): https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/reverseproxy/reverseproxy.go
- [caddy-module-ratelimit] Caddy module registry, `http.handlers.rate_limit`: https://caddyserver.com/docs/modules/http.handlers.rate_limit
- [caddy-ratelimit] `mholt/caddy-ratelimit` README and history: https://github.com/mholt/caddy-ratelimit
- [caddy-docker] Official Caddy Docker image, "Adding custom Caddy modules": https://hub.docker.com/_/caddy
- [rlf-readme] `rate-limiter-flexible` README: https://github.com/animir/node-rate-limiter-flexible
- [rlf-wiki] `rate-limiter-flexible` wiki, Overall example (login protection): https://github.com/animir/node-rate-limiter-flexible/wiki/Overall-example
- [lichess-limiters] Lichess `modules/web/src/main/Limiters.scala` and `app/controllers/Setup.scala` at `bedc42ae6d`: https://github.com/lichess-org/lila/blob/master/modules/web/src/main/Limiters.scala
- [bgio-server-src] boardgame.io `src/server/index.ts`: https://github.com/boardgameio/boardgame.io/blob/main/src/server/index.ts
- [altcha-lib-readme] `altcha-lib` 2.6.0 README: https://github.com/altcha-org/altcha-lib
- [cap-readme] Cap README and LICENSE (Apache-2.0): https://github.com/tiagozip/cap
- [cap-guide] Cap guide (Standalone, Valkey): https://trycap.dev/guide/
- [mcaptcha-compose] mCaptcha `docker-compose.yml` and repo (AGPL-3.0): https://github.com/mCaptcha/mCaptcha
- [ldnoobw] List of Dirty, Naughty, Obscene and Otherwise Bad Words (CC-BY-4.0): https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words
- [glin-readme] `glin-profanity` 3.3.0 README and `package.json`: https://github.com/GLINCKER/glin-profanity
- [obscenity-readme] `obscenity` 0.4.6 README: https://github.com/jo3-l/obscenity
- [2toad-langs] `@2toad/profanity` 3.3.0 `supported-languages.md`: https://github.com/2Toad/Profanity
- [uts39] UTS #39 Unicode Security Mechanisms, 18.0.0 (2026-08-27): https://www.unicode.org/reports/tr39/
- [owasp-auth] OWASP Authentication Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html
- [owasp-password] OWASP Password Storage Cheat Sheet (scrypt parameters): https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- RFC 6598, IANA-Reserved IPv4 Prefix for Shared Address Space (CGNAT): https://www.rfc-editor.org/rfc/rfc6598
- [measured] Benchmarks and word-list checks run by me on 2026-10-18: Node 26.11.1 on an Apple M3, `zod` 4.6.7, `msgpackr` 2.1.0, `naughty-words` 1.2.0; micro-benchmarks, so treat them as orders of magnitude.
- v1 code: `server/index.ts`, `server/roomSystem.ts`, `server/types/RoomSystemTypes.ts`, `client/src/randomName.js`, `client/src/Store/slices/userSlice.js`, `client/src/Components/LobbyComponent/Lobby.jsx`, `client/src/Components/CreateLobbyComponent/CreateLobby.jsx`.
