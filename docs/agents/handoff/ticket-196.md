# Ticket #196 (Bots in the Lobby) — extension points and gotchas

Branch `agent/issue-196-bots-in-the-lobby`, from main at `f16969f`.

## What landed

- A seated Player adds a Bot to the next empty Seat (`AddBot`) and takes any
  Bot off its Seat (`RemoveBot`); both are Room intents, so they never reach the
  rules engine. A Bot gets `newPlayerName`'s generated name and a
  `StoredSeat.bot` flag.
- A Bot is a rules `PlayerState.bot` (the engine never reads it for a rule; it
  rides into `PublicView.players` through `revealOf`). `STATE_VERSION` is 3,
  migration `2 → 3` adds `bot: false` to every stored Player, and
  `packages/rules/test/fixtures/state-v3.json` is the snapshot at 3.
- The Room plays a Bot's Decisions: `GameDriver.#scheduleBot` arms one
  wake-up for `max(state.actsAfter, now) + BOT_DELAY_MS` (`1_500` in
  `game-driver.ts`), and `#playBot` calls `botIntent(publicView(game, timing))`
  and submits it through `TurnClock.run` with the Bot's Player id as the actor.
  `#commit` and `resume` arm it; `dispose` and `#end` cancel it; a stale
  wake-up (the live `version` moved on) or a non-Bot current Player does
  nothing.
- A full Lobby leaves the Lobby list: `GameRoom.syncListing` (from
  `broadcastLobby` and a restore) hides through `hideFromList` and comes back
  through `listAgain` when a Seat opens. `#listed` is the Room's own flag;
  `unlisted` is set on the Colyseus listing. This applies to a full Lobby of
  Guests as well, not only one filled with Bots (GLOSSARY's _Lobby list_
  updated).
- Web: `BotMark` (`data-testid="bot-mark"`) on the Seat card, Player card/chip
  and both Podium rows; the Seat card's first open Seat has an `Add Bot`
  button, a Bot's card has `Remove Bot`. Messages `lobby_add_bot`,
  `lobby_remove_bot`, `bot_mark`.
- `apps/server/test/bots.test.ts` covers the Lobby seam with the
  `ManualScheduler` (add/remove/validation, list hiding, start with one Guest
  and a Bot, the Bot's Roll at exactly `BOT_DELAY_MS` after the gate).
  `apps/e2e/tests/bots.spec.ts` is one Guest + one Bot.

## Extension points and gotchas

- **`#playBot` acts only when `player.bot === true`.** Ticket #198 (a Bot for a
  dropped Guest) must widen that condition to a Room-seat fact (a Guest Seat
  with no live client), cancel the pending action when the Guest reconnects,
  and keep the `version` guard so an applied Bot action stands.
- **Nothing suppresses Bots when no Guest is connected.** Ticket #199 must
  check the Room's live connections before scheduling (a Bot-only game keeps
  playing otherwise until every Turn timer has fired). `GameRoom.gauges`
  already counts a Bot Seat as neither connected nor held.
- **`AddBot` refuses a full Lobby with `ROOM_FULL`.** Ticket #197 changes that
  path (`onAuth`'s `seats.length >= maxPlayers` check and `onJoin`) to replace a
  Bot instead; `syncListing` then sees the same Seat count and keeps the Lobby
  off the list.
- **The Room list hides every full Lobby**, so a join to a full one by code is
  the only way in; `onAuth` still answers `ROOM_FULL` for it. `lobby-list.spec.ts`
  and the server lobby-list test now assert the removal, not a "Full" tile.
- **`botIntent(view)` is the only policy call.** Ticket #200 adds the Deal
  phase inside `packages/rules/src/bot.ts`; the driver needs no change. A
  refused Bot intent is logged (`Bot intent refused`) and the Turn timer still
  moves the game on.
- **The rules' `bot` flag is data, not a rule switch.** Do not branch rules on
  it; the Room and the views are the only readers.
- A restored Lobby keeps its Bot Seats (no hold is put on them) and
  `syncListing` hides a full one; a restored running game re-arms the Bot
  wake-up with `max(actsAfter, now)`. #199 now arms it only when a Guest is
  connected, so a restored game with nobody back plays no Bot until a Guest
  connects.
