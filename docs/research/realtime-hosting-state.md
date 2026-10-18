# Research: realtime transport, hosting & game state storage

Ticket: #2 (part of map #1). Researched 2026-10-18. Every price, version and platform status below is as of that date and comes from the vendor's own docs, pricing page or source repo (see [Sources](#sources)). Glossary terms (Room, Lobby, Player, Guest, Board, Field) follow `GLOSSARY.md`; ADR-0001 (the server owns the game rules) is taken as given.

## Question

Which realtime transport, hosting platform and game-state store fit a server-authoritative, turn-based game of up to four Players per Room at ~1,000 concurrent Rooms (~4,000 Players), scaling horizontally to 10× without a rewrite, at ≤ ~50 USD/month at launch on managed platforms? For each option: how Guests reconnect into a running game, how Room and game state survive deploys and restarts, how Rooms are routed to instances, cost at launch and at 10×, and operational load.

## Options compared

1. **Socket.IO + Redis/Valkey adapter** on a managed Node host (Fly.io as the reference host; Render and Railway noted). This is the closest to v1, which runs Socket.IO 4 and keeps every Room in an in-process `Map` (`server/index.ts`).
2. **Colyseus**, either self-hosted on Fly.io with `RedisDriver` + `RedisPresence`, or on Colyseus Cloud.
3. **Cloudflare Durable Objects**: one Durable Object per Room, using the `partyserver` library on the server and `partysocket` on the client. **Hosted PartyKit is not an option.** Its docs say: "The hosted PartyKit platform is shutting down. Deploys stop on 16 October and the platform shuts down on 23 October 2026." `npx partykit deploy` to your own Cloudflare account also "will stop working too, on 23 October 2026". The docs say: "For new projects, use PartyServer and deploy with `wrangler`." [PK-deploy]

Current versions on npm, checked 2026-10-18 [NPM]: `socket.io` 4.8.4, `@socket.io/redis-adapter` 8.3.0 (last release 2024-03), `@socket.io/redis-streams-adapter` 0.3.1, `colyseus` 0.18.9 / `@colyseus/core` 0.18.19, `@colyseus/redis-driver` and `@colyseus/redis-presence` 0.18.5, `partyserver` 0.5.10, `partysocket` 1.3.0.

### 1. Socket.IO + Redis/Valkey adapter

- **Routing.** Socket.IO has no idea which instance owns a Room. The Redis adapter takes every packet "sent to multiple clients (e.g. `io.to("room1").emit()`)" and publishes it over Redis Pub/Sub so that every node can deliver it [SIO-redis]. Sticky sessions are still required: without them you get "HTTP 400 responses (you are reaching a server that is not aware of the Socket.IO session)" [SIO-redis]. You can skip them only by using WebSocket (or WebTransport) alone, with no HTTP long-polling [SIO-nodes]. The client's default transports include polling [SIO-client].
- **Rules execution (ADR-0001).** The four Players of a Room can land on different instances. Their intents therefore have to be serialized somewhere, and nothing in Socket.IO does that. There are two ways to build it yourself. (a) Route every connection for a Room code to one instance, for example by replaying the upgrade request to a specific Fly Machine with `fly-replay: instance=<id>` [FLY-replay]. You then also have to handle rebalancing when instances are added or removed. (b) Make Redis the source of truth for game state and do a compare-and-set on every intent. This is an inference: it follows from the adapter offering broadcast only.
- **Reconnect.** The client reconnects by default, with infinite attempts and a delay that starts at 1 s and caps at 5 s [SIO-client]. Connection state recovery restores "the `id`, the rooms and the `data` attribute of the socket" within `maxDisconnectionDuration`. The classic Redis adapter does **not** support it; the Redis Streams adapter does. The docs also warn that "the recovery will not always be successful" [SIO-csr][SIO-streams]. The game therefore needs its own resync in any case: the Guest identity goes in the handshake `auth` [SIO-client], and the server rejoins the socket to its Room and sends the full state.
- **Deploys and restarts.** Process memory is lost. State survives only if you write it to Redis yourself. The Streams adapter "will properly handle any temporary disconnection to the Redis server and resume the stream without losing any packets" and is compatible with Valkey [SIO-streams].
- **Ops load: high.** You run a Node fleet, a managed Redis, sticky or WebSocket-only routing, per-Room serialization and persistence, all custom.

### 2. Colyseus

- **Routing.** "Each Room belongs to a single Colyseus process." Any process can reserve a seat (through the Redis driver and presence), and the client then connects straight to the owning process at its `publicAddress`. Rooms never move between processes [COL-scale]. On Colyseus Cloud, "You do not need to specify driver, presence, or publicAddress" [COL-scale]. Because each Room has exactly one process, ADR-0001 fits naturally: one process runs one Room's rules.
- **Reconnect.** In `onDrop()`, `allowReconnection(client, seconds)` holds the seat; it "expires by itself" after that many seconds, or with `"manual"` it stays held until you reject it. The client SDK retries with exponential backoff. To reconnect after a page reload you "Persist `room.reconnectionToken`" [COL-reconn]. All of this works only while the process that owns the Room is alive.
- **Deploys and restarts.** "Rooms are ephemeral by default." To keep state you save it to a database in `onDispose()` and reload it in `onCreate()` [COL-faq]. Graceful shutdown locks the Rooms, calls each Room's `onBeforeShutdown()` and "waits until all rooms have zero connections". It does not migrate or restore anything [COL-shutdown]. On Fly the grace period (`kill_timeout`) is at most 300 s [FLY-config], which is shorter than a timed game. `devMode` does restore Rooms and their state across restarts, but the docs say: "Do not use `devMode` in a production environment" [COL-dev]. Keeping a Room alive across a deploy (snapshot, recreate under the same Room code, let Guests back in) is therefore custom work.
- **Bandwidth.** State sync sends only changed properties ("Only the latest mutation of each property is queued and sent") [COL-state]. Broadcasts stay inside the owning process, so they never pass through Redis.
- **Capacity.** "A small cloud server (1 vCPU, 1GB RAM) can typically handle 1,000-2,000 concurrent connections for simple games" [COL-faq].
- **Colyseus Cloud** "Starting at $15/mo", "No CCU/DAU/MAU limits", "Unlimited bandwidth" [COL-price]. The plan tiers and the price of more than one server are not on the public page; the pricing simulator shows them [COL-billing].
- **Ops load:** medium on Colyseus Cloud, medium-high self-hosted. Either way, persistence across deploys is yours to build.

### 3. Cloudflare Durable Objects (PartyServer + partysocket)

- **Routing.** "Each Durable Object has a globally-unique name", and Durable Objects "are single-threaded" [CF-what]. `idFromName(roomCode)` therefore always reaches the same Room object [CF-ns]: that object is the single owner ADR-0001 needs, and there is no load balancer, sticky session or Redis to run. PartyServer routes `/${prefix}/:server/:name` to the object [PS]. The first lookup of a name-derived ID "can take up to a few hundred milliseconds" [CF-ns]. Each object starts near where it is first requested [CF-what].
- **Reconnect.** partysocket "Reconnects when a connection drops", "Buffers messages when not connected", and accepts a stable client `id` [PSOCK], which can carry the Guest identity. A reconnecting Guest reaches the same Room object from anywhere.
- **Deploys and restarts.** "Code updates disconnect all WebSockets. Deploying a new version restarts every Durable Object" [CF-ws]. The SQLite storage survives, and writes are durable before anything is sent: "the system will pause outgoing network messages ... until all previous writes have been confirmed flushed to disk" [CF-storage]. Cloudflare's guidance is to "regularly write to storage", not to rely on shutdown hooks [CF-life]. A deploy is then a mass reconnect, followed by a reload of state from storage.
- **Hibernation.** With hibernatable WebSockets, "WebSocket clients remain connected" while the object is evicted, but "In-memory state is reset" [CF-ws]. So storage has to be the source of truth. `setTimeout` or `setInterval` prevents hibernation [CF-life]. The game clock should use an alarm instead: one per object, executed at least once, and able to wake the object [CF-alarm]. This also answers the map's open question about who keeps the game clock.
- **Limits.** The number of objects is unlimited, each object has a soft limit of 1,000 requests/s and 10 GB of storage [CF-limits]. A four-Player Room is nowhere near either.
- **Ops load: lowest.** One `wrangler deploy`, no servers, no Redis. The cost is lock-in to the Workers runtime and Cloudflare's pricing.

## Cost model

All three options share these assumptions. They are mine, not vendor facts, and the grilling ticket should confirm them:

- Each Room produces about **12 incoming intents per minute**: four Players, roughly 3 turns a minute, about 3 intents per turn.
- Each Player opens about 2 WebSocket connections an hour.
- A message handler runs for about 5 ms.
- A full v1 `gameState` is a few KB: `server/GameSystem/initialState.ts` is 5.8 KB of source. A diff or event payload is about 200 B.
- **A = average concurrent Rooms over the month**, which is not the same as peak. A month is 720 h.
- **Persistence granularity** is the main lever. *Per-intent* means one storage write per accepted intent (12 a minute), so nothing that was acknowledged is ever lost. *Per-turn* means one write per completed turn (about 4 a minute), so a deploy can roll a Room back to the start of the current turn.

**Durable Objects** (Workers Paid). The pieces: a $5/month minimum [CF-workers]. Requests: 1 M included, then $0.15/M. Incoming WebSocket messages are billed at 20:1, and outgoing messages and protocol pings are free. Duration: 400,000 GB-s included, then $12.50/M GB-s, charged only while the object is not eligible for hibernation. SQLite rows written: 50 M included, then $1.00/M. Usage is rounded up to the next unit [CF-price]. Egress is free [CF-workers]. With hibernation, **rows written are almost the whole bill**. Each Room-hour costs about $0.00072 with per-intent writes and $0.00024 with per-turn writes. Duration stays inside the free tier until A ≈ 1,200.

| A (avg Rooms) | Per-intent writes | Per-turn writes |
|---|---|---|
| 100 | $7 | $5 |
| 300 | $112 | $8 |
| 1,000 (launch peak, sustained) | $479 | $133 |
| 3,000 | $1,538 | $501 |
| 10,000 (10× peak, sustained) | $5,224 | $1,768 |

The $50 budget is exceeded at A ≈ 190 with per-intent writes and A ≈ 540 with per-turn writes (computed from [CF-price]).

**Colyseus self-hosted on Fly.io.** Fly shared-cpu-1x costs $6.70/month with 1 GB and $3.69 with 512 MB, and outbound data costs $0.02/GB in North America and Europe [FLY-price]. Machines are provisioned for peak load, so this cost does not fall when A falls.

- **Launch:** 4 × 1 GB Machines = $26.80. This assumes 1,000-2,000 connections per Machine [COL-faq], which still has to be load-tested on shared CPU. Add Upstash Fixed 250 MB at $10/month, which allows unlimited commands, 50 GB/month of bandwidth and at most 10,000 commands/s [UPS]. Add about $8 of egress at A = 1,000 with diff payloads. **Total about $45/month.** Sending the full state on every update instead of diffs costs about $207/month in egress at A = 1,000, and per-turn full-state snapshots alone (~860 GB/month) would far exceed Upstash's 50 GB bandwidth limit.
- **10×:** about 40 Machines ($268), plus a larger Redis plan (price not verified), plus about $83 of egress at A = 10,000. **Total about $350+/month.**
- **Colyseus Cloud:** from $15/month; prices for larger deployments are not verified.

**Socket.IO + Redis on Fly.io.** Compute is the same as for Colyseus, about $27 at launch and about $270 at 10×. Redis traffic is heavier: every broadcast goes through Redis [SIO-redis], and so does state compare-and-set if Redis is the source of truth. That traffic pushes against Upstash Fixed's 50 GB/month cap. Render Key Value is a flat-priced, Redis-compatible store (Standard: $10/month for 256 MB, $20/month for 1 GB) alongside Render web services ($7/month for 512 MB, $25/month for 2 GB). Render's internet bandwidth includes 5-25 GB depending on plan, then $0.15/GB [RENDER]. Railway charges about $20 per vCPU-month, about $10 per GB-month and $0.05/GB egress [RAIL]. **Estimate: about $45-60 at launch and about $350-500 at 10×.** This is rough, and the payload size dominates it.

## Comparison table

| | Socket.IO + Redis/Valkey | Colyseus (Fly or Colyseus Cloud) | Durable Objects + PartyServer |
|---|---|---|---|
| Room → instance routing | None; broadcast over Redis; sticky sessions or WebSocket-only [SIO-redis][SIO-nodes] | One process per Room; seat reservation then `publicAddress` [COL-scale] | One object per Room code, globally unique and single-threaded [CF-what] |
| Single owner for a Room's rules (ADR-0001) | DIY (custom routing or Redis compare-and-set) | Built in | Built in |
| Guest reconnect | Auto-reconnect; state recovery within a window, Streams adapter only, "not always" [SIO-csr] | `allowReconnection` seat hold while the process lives [COL-reconn] | partysocket auto-reconnect + stable `id`; same object from anywhere [PSOCK] |
| Survives deploy/restart | DIY: state in Redis | DIY: "ephemeral by default"; devMode is not for production [COL-faq][COL-dev] | Yes: SQLite storage persists; deploy drops sockets and clients reconnect [CF-ws][CF-storage] |
| Game clock | `setTimeout` in a process (lost on restart) | `this.clock` in a process (lost on restart) | Durable alarm, at-least-once [CF-alarm] |
| Cost at launch (A ≤ 1,000) | ~$45-60, mostly flat | ~$45 (self-hosted), flat | $5-8 at A ≤ 300 per-turn; $133-479 if 1,000 Rooms run 24/7 |
| Cost at 10× | ~$350-500 | ~$350+ | $500-5,224, depending on A and write granularity |
| Ops load | High | Medium (Cloud) / medium-high (self) | Lowest |
| Lock-in | Low | Low-medium | High (Workers runtime) |

## Recommendation

**Use Cloudflare Durable Objects: one Durable Object per Room, with PartyServer and partysocket, hibernatable WebSockets, SQLite storage as the source of game state, and an alarm for the game clock.** It is the only option where the standing constraints (Guests reconnect, state survives deploys and restarts, managed rather than self-run, 10× without a rewrite) and ADR-0001's single owner per Room come built in. The other two need custom routing and persistence. Deploy hosted PartyKit nowhere: it shuts down on 2026-10-23 [PK-deploy].

Trade-offs to accept or reject in grilling:

- **Cost grows with play, and storage writes are what grows.** If the ~1,000 concurrent Rooms is a peak, and the monthly average is a few hundred Rooms with per-turn persistence, launch costs about $5-10/month. If 1,000 Rooms really run around the clock, it costs $133-479/month, over budget. At 10× sustained load it costs $1.8k-5.2k/month, against roughly $350-500 for a Node fleet. Colyseus on Fly or Colyseus Cloud is the runner-up if a flat, capacity-priced bill at high sustained load matters more than ops load and durability built into the platform.
- **Every deploy disconnects every Player.** Clients reconnect and reload from storage, so the UI needs a smooth "reconnecting" state, and deploys should happen off-peak.
- **The rules are written for the Workers runtime, not plain Node.** If the rules module is pure TypeScript with no I/O, it can be tested in Node and run in either.
- **Socket.IO is not recommended.** It is familiar from v1, but it does nothing to solve ownership, persistence or routing, and has the highest ops load.

## Open questions for the grilling ticket (#9)

1. Is "~1,000 concurrent Rooms" a peak or a sustained level? What average load (A) should the budget be sized for? This alone decides whether Durable Objects fit $50.
2. What is the acceptable rollback on a deploy or crash: none (per-intent writes) or back to the start of the current turn (per-turn writes)? This changes the Durable Objects bill by 3×.
3. What is the acceptable monthly cost at 10×? Is the budget "≤ $50 at launch, proportional after", or does it need a ceiling?
4. Should the server send full state or events and diffs? Full v1-style state on every update dominates egress on Fly (~$207/month at A = 1,000) and Redis bandwidth. On Cloudflare egress is free, but message size still matters on mobile.
5. Is lock-in to Cloudflare's Workers runtime acceptable? Should the rules be kept as a runtime-agnostic TypeScript module so that a move to Colyseus stays possible?
6. Is a mass reconnect on every deploy acceptable UX? How long should a dropped Guest keep their seat (the reconnect window) before the game continues without them?
7. Region: Durable Objects start near the first request [CF-what]. Is that fine for an audience in HU, EN and DE markets, or should a `locationHint` pin Rooms to Europe [CF-ns]?
8. To validate before committing: the assumption of about 12 intents per Room per minute (from v1 play), and, if Colyseus is chosen, a load test of connections per shared-cpu Machine.

## Sources

All accessed 2026-10-18.

- [NPM] npm registry, `https://registry.npmjs.org/<package>` (dist-tags.latest) for socket.io, @socket.io/redis-adapter, @socket.io/redis-streams-adapter, colyseus, @colyseus/core, @colyseus/redis-driver, @colyseus/redis-presence, partyserver, partysocket.
- [SIO-redis] Socket.IO, Redis adapter: https://socket.io/docs/v4/redis-adapter/
- [SIO-streams] Socket.IO, Redis Streams adapter: https://socket.io/docs/v4/redis-streams-adapter/
- [SIO-csr] Socket.IO, Connection state recovery: https://socket.io/docs/v4/connection-state-recovery
- [SIO-nodes] Socket.IO, Using multiple nodes: https://socket.io/docs/v4/using-multiple-nodes/
- [SIO-client] Socket.IO, Client options: https://socket.io/docs/v4/client-options/
- [COL-scale] Colyseus, Scalability: https://docs.colyseus.io/scalability
- [COL-reconn] Colyseus, Reconnection: https://docs.colyseus.io/room/reconnection
- [COL-shutdown] Colyseus, Graceful shutdown: https://docs.colyseus.io/server/graceful-shutdown
- [COL-dev] Colyseus, Development mode: https://docs.colyseus.io/server/devmode
- [COL-faq] Colyseus, FAQ: https://docs.colyseus.io/faq
- [COL-state] Colyseus, State synchronization: https://docs.colyseus.io/state
- [COL-price] Colyseus Cloud pricing: https://colyseus.io/pricing/
- [COL-billing] Colyseus Cloud, Pricing & billing: https://docs.colyseus.io/cloud/pricing-billing
- [CF-price] Cloudflare, Durable Objects pricing: https://developers.cloudflare.com/durable-objects/platform/pricing/
- [CF-workers] Cloudflare, Workers pricing: https://developers.cloudflare.com/workers/platform/pricing/
- [CF-limits] Cloudflare, Durable Objects limits: https://developers.cloudflare.com/durable-objects/platform/limits/
- [CF-ws] Cloudflare, Durable Objects WebSockets best practices: https://developers.cloudflare.com/durable-objects/best-practices/websockets/
- [CF-life] Cloudflare, Durable Object lifecycle: https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/
- [CF-storage] Cloudflare, Storage API: https://developers.cloudflare.com/durable-objects/api/storage-api/
- [CF-alarm] Cloudflare, Alarms: https://developers.cloudflare.com/durable-objects/api/alarms/
- [CF-ns] Cloudflare, Durable Object namespace: https://developers.cloudflare.com/durable-objects/api/namespace/
- [CF-what] Cloudflare, What are Durable Objects: https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/
- [PK-deploy] PartyKit, Deploy to your own Cloudflare account (shutdown notice): https://docs.partykit.io/guides/deploy-to-cloudflare/
- [PS] cloudflare/partykit, packages/partyserver README: https://github.com/cloudflare/partykit/tree/main/packages/partyserver
- [PSOCK] cloudflare/partykit, packages/partysocket README: https://github.com/cloudflare/partykit/tree/main/packages/partysocket
- [FLY-price] Fly.io, Pricing: https://docs.fly.io/about/pricing
- [FLY-replay] Fly.io, Dynamic request routing (fly-replay): https://docs.fly.io/networking/dynamic-request-routing
- [FLY-config] Fly.io, App configuration (`kill_timeout`): https://docs.fly.io/reference/configuration
- [UPS] Upstash, Redis pricing: https://upstash.com/pricing/redis
- [RENDER] Render, Pricing: https://render.com/pricing
- [RAIL] Railway, Pricing: https://railway.com/pricing
