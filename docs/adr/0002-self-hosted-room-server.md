# A self-hosted Room server, independent of any hosting provider

v2 runs as one Colyseus 0.18 server on Node 26 LTS, keeping game state in a SQLite file, packaged with docker compose so it starts the same way on a laptop, an own Linux server or any VPS. Research recommended Cloudflare Durable Objects, which come with Room ownership, persistence and reconnect built in, but we rejected any dependency on a provider's proprietary runtime: the app must stay independent while the hosting is undecided and the budget is zero. The cost is that persistence across restarts (restoring each unfinished Room under its own code on boot) and, later, multi-server routing are ours to build. The rules stay in an I/O-free package so the host can be replaced without touching the game.

## Considered Options

- **Cloudflare Durable Objects + PartyServer**: least ops and durable by design, but locks the Room host to the Workers runtime.
- **Socket.IO + Redis**: closest to v1, but gives nothing for single Room ownership, persistence or routing.
- **Thin Node (Hono + `ws`)**: fewest dependencies, but Room ownership, Lobby listing, reconnect and multi-process scaling would all be custom.

## Consequences

- Every deploy or restart drops every socket; clients reconnect and the server restores Rooms from SQLite, so the UI needs a "reconnecting…" state.
- Scaling past one server means Postgres behind the `RoomStore` interface plus Colyseus's Redis driver and presence, and a lock so each restored Room is taken by exactly one process.
