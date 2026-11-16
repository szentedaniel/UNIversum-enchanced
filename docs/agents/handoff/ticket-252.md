# Ticket #252 (a watcher reads the Lobby; both screens show the spectator count) — extension points and gotchas

Branch `agent/issue-252-web-watch-a-lobby-read-only-and-show-the-spectator`, from `main` after #249
(the messages carry the count) and #251 (the watch join and the read-only Game). Spec #179; #253
builds on it. The rules engine, `GameState`, the stored snapshot and the server are untouched.

## The count in the client store

- **`apps/web/src/stores/room-store.ts`**: `RoomState.spectators: number` (initial `0`),
  `ReceivedPush.spectators`, and both writers: `receivePush` stores the push's count and
  `receiveLobby` stores `lobby.spectators`. `reset()` returns it to `0`. It lives beside `role`,
  never inside `Push`, so a count-only push replaces the push without touching the Playback frame.
- **`apps/web/src/playback/playback-store.ts`**: `start()` keeps a `currentPush` and returns early
  when the new push has **no events, the same `view.version` and the same view field for field**
  (`restatesView`). That is the count-only push (#249), so the running Playback keeps its core, timer
  and `eventsReached`. The view comparison is what tells it apart from a made-up view: the e2e hooks
  clone the push and keep its `version`, so `version` alone would swallow every `showView` push.
  Consequence for e2e: `playback().seq` keeps the Playback push's `seq` after a watcher joins or
  leaves. `room().push.seq` moved on then; since #328 it stays too (see `ticket-328.md`).
- **`apps/web/src/test-hooks.ts`**: `showView` passes `spectators: roomStore.getState().spectators`,
  so a made-up view never resets the count a spec is watching for.

## The chip

- **`apps/web/src/components/SpectatorChip.tsx`**: `SpectatorChip({ count, className })` renders
  `data-testid="spectators"` — an `Eye` icon, the number (aria-hidden) and an `sr-only` label from
  `spectators_count` (one) / `spectators_count_plural` (many). It returns `null` at `0`, so a Room
  nobody watches looks unchanged.
- **Messages** `spectators_count` and `spectators_count_plural` carry `{count}` in hu, en and de;
  paraglide's plural annotations are not used anywhere in the repo, so the two keys are explicit.
- **`apps/web/src/screens/Game.tsx`** draws it in `statusRow` after the `data-testid="watching"`
  marker, so both layouts (wide status row and phone strip) have it.
- **`apps/web/src/screens/Lobby.tsx`** draws `WatchingMark` (the same `data-testid="watching"`) and
  the chip in one header row, rendered only when `spectator || spectators > 0` — an always-rendered
  empty row would add a flex `gap` to every normal Lobby.

## The read-only Lobby (#252 replaced #251's waiting state)

- One render for both roles. `me` is `useStore(roomStore, seatedMeOf)`, so a spectator's `null`
  keeps every comparison (`you`, `released`) false; the creator crown (`creator={seat.playerId ===
  lobby.creatorId}`) is a fact of the Room and still shows to a watcher.
- `spectator` gates only the controls: `onRemoveBot`, the open (empty) Seat cards with their
  `AddBot`, the `Start`/released block at the bottom, and the header's back link (`/`, not
  `/rooms`). A watcher sees the Room's name, code sticker, invite card, taken Seats (Bot marks and
  held countdowns), the settings grid, and `watch_waiting` in place of `Start`.
- The Lobby→Game move is unchanged: the `started` selector (`s.code === code && s.push !== null`)
  navigates to `/game/:code` on the first Game push, for both roles, and `ensureJoined` is still a
  no-op for a connected spectator.

## What #253 can rely on

- Selectors: `data-testid="watching"` on both screens, `data-testid="spectators"` for the chip,
  `data-testid="invite-link"` and `data-testid="room-code"` in the watcher's Lobby, `watch` on Home.
- A watcher's Lobby renders no `>Start<`, no `lobby_add_bot`/`lobby_remove_bot`, no
  `data-testid="take-seat"` and no `lobby_open_seat` text; assert by those, not by "no buttons",
  because the code and invite copies are buttons.
- The count is not in the typed e2e `room()` mirror (`apps/e2e/tests/test-hooks.ts`); read the chip
  from the DOM, or add `spectators` there when a spec needs it.

## Tests

- **`apps/web/test/room-store.test.ts`**, `describe("the spectator count")`: a push's count, the
  count-only push at the same version, the Lobby message's count, and the Playback keeping
  `currentPlayback()` (the same core) with the same `eventsReached`.
- **`apps/web/test/watch.test.ts`**: the read-only Lobby (name, code, taken Seats with the Bot mark
  and held Seat, settings, invite, marker, count, `watch_waiting`), the absent controls with the
  watcher's `me` `null` and with a stale `me` naming the creator, the `lobby_you` absence with a
  stale `me`, the chip at 0/1/many on the Lobby and in the Game's status row, and the chip updating
  from a push that carries no events.
