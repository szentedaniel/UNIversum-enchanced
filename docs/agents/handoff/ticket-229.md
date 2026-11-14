# Ticket #229 (Room broadcasts chat with flood control): extension points and gotchas

Branch `agent/issue-229-server-room-broadcasts-chat-with-flood-control` (on `main`). Builds on #228's protocol chat (`MESSAGE.chat`, `ClientChat`/`ChatEvent`, `chatSchema`, `CHAT_IDS`).

## The handler (`apps/server/src/room/game-room.ts`)

- `onCreate` registers `onMessage(MESSAGE.chat, …)` between the `intent` handler and the `"*"` catch-all. Colyseus runs `"*"` only for a type with no handler of its own (`RoomMessages.onData`), so registering `chat` is what keeps it from answering `MALFORMED`.
- `onChat(client, message)` is the whole feature: `seatOf(client)` (a connection with no Seat is ignored, as `onIntent` does), `chatSchema.safeParse` → `MALFORMED` when it fails, `this.game === null` → `NOT_OFFERED` (a Lobby has no tray, spec #176's out of scope), else `broadcast(MESSAGE.chat, { seat, id })`. Every client gets the accepted chat, the sender included.
- `ChatEvent.seat` is the **Seat index**: `this.seats.indexOf(seat)`, the number `PlayerView.seat` carries (`setupGame` numbers the Seats in join order, and a running Room's Seat list never reorders). The wire has no `playerId`; a client maps it with `view.players.find((p) => p.seat === event.seat)`.
- The remaining branches: a connection with no Seat (the spectator path #248 will create) is ignored silently — hide the tray for spectators rather than answer them a Rejection; a seat **in the payload** is an extra field, so `chatSchema` refuses it and nobody can chat under another Player's name.
- Chat never calls `commit`, the store or `engine.apply`, changes neither `version` nor `turnDeadline`, and sends no `game` push: `test/chat.test.ts` "leaves the game state, its version and the stored Room untouched" compares the stored row byte for byte. The Podium still has `this.game` (it goes null only in `returnToLobby`), so chat works there.

## Flood control

- `admit(client, meters, perSecond = guard.limits.intentsPerSecond)` now serves both maps: `#flood` (every message: intents, chat and the `"*"` catch-all) and `#chatFlood` (chat only); `meterLimits(perSecond)` gives `FloodMeter` the ladder's close thresholds at the requested rate.
- A chat counts once in the intent meter and once in the chat meter; the handler returns after the first meter refuses, so one dropped chat gets exactly one `SLOW_DOWN`. Both go through `guard.refused("intent_flood", …)` and the existing `rejections_total`/`rejection` path — no new metric, no new reason.
- `chatsPerSecond` in `apps/server/src/limits.ts` (`LIMIT_CHATS_PER_SECOND`, default 1), also listed with the other limits in `.env.example`; `apps/server/src/config.test.ts` pins the default and the env override. `intentFloodCloseSeconds` and `intentBurstClose` are shared with intents, so a chat storm closes through whichever meter trips first.
- Both meters are dropped in `onLeave` next to each other — that is the only place `#flood` was ever deleted; add any third meter there too.
- The meters read the real clock (`performance.now()`), not the `Scheduler`, so a test cannot advance them: two chats from one connection inside one test second always collide, which is what the flood test relies on. An e2e spec that has one Guest chat twice must leave about a second between the taps (or the spec raises `LIMIT_CHATS_PER_SECOND`, as `playwright.config.ts` raises the per-IP limits).

## Tests and helpers

- `apps/server/test/chat.test.ts`: `fullLobby` (join order and the `welcome` ids) and `startedGame` (Start, every client's first `game` push taken). Six cases: broadcast with the sender's Seat during another Player's Turn, an unknown id (`MALFORMED`, nothing broadcast), a payload `seat` (same), a second chat in the second (`SLOW_DOWN`, nothing broadcast), a Lobby chat (`NOT_OFFERED`), and the untouched state/version/store.
- `TestClient` (`apps/server/test/helpers.ts`) carries `chat` in its `Messages` map and queue, and `sendChat(message)` sends a raw payload, so malformed ones are possible; `next("chat")`/`pending("chat")` behave as for the other types.

## What this does not do

- No web code: the bubbles (#230), the tray and its cooldown (#231), mute (#232) and the hu/en/de line messages are theirs.
- Nothing is persisted or replayed: a Guest who reconnects sees no missed bubbles, and a restart loses them.
- Spectators (#248) do not exist yet; `onChat`'s missing-Seat branch is the seam for them.
