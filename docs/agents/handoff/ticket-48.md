# Ticket #48 (review fixes) — what changed and gotchas

Branch `ticket/48-review-fixes`, merged into `v2-modernization` after a6cc342.

## Server

- **Early wake-up (#1).** `GameRoom.timeOut` now calls `rearmEarly(turn)` when the engine rejects `TurnTimedOut`: if the game's `turn` still matches and `turnDeadline` is ahead, it schedules again at exactly `turnDeadline`. A wake-up for an earlier phase of the same Turn also lands here. `systemScheduler.at` re-checks `Date.now()` and waits the remainder, so a Node timer that fires a millisecond early does not reach the task. `ManualScheduler.fireEarly(time)` (test/helpers.ts) runs a scheduled task before its time, marks it done (no second run), like the real timer; `lastTaskAt` still returns a task the scheduler will run again (a late/stale wake-up).
- **Creator (#3).** `GameRoom.creatorId: PlayerId | null` is set when the creator's Seat is taken, saved in the `StoredRoom` snapshot (`creatorId`) and restored (`null` for snapshots written before this ticket). `LobbyMessage.creatorId` tells the client which Seat gets the crown; the client no longer assumes Seat 0.
- **Production clock overrides (#11).** `loadConfig` drops `GAME_TURN_LIMIT_MS`/`GAME_MINUTE_MS` when `NODE_ENV=production` (kept in the config's `timing` only outside production), and `main.ts` logs a warning when they are set there. E2E starts the server without `NODE_ENV=production` (see `playwright.config.ts` webServer env), so the overrides still work; do not add `NODE_ENV=production` to that server env.
- **main.test (#4).** The spawned-server tests pass `PORT=0`/`INTERNAL_PORT=0` and read the bound ports from the **JSON** "Server listening" line, which now carries the port actually bound (`server.transport.server.address()`), not `config.port`. Both tests run production logs (NDJSON) for this reason. This removed the `freePort()` probe race; the file ran 30× green.
- `PlayerId` (rules) now types `GameRoom`'s hold Map and Seat helpers instead of `string` (#8).

## Rules / view

- **Final standings (#6).** `publicView.standings: Standing[] | null` (`{ player, wealth }`) is filled only at `gameOver`: the named winner first, then non-Bankrupt Players by Wealth → cash → earlier Seat, then Bankrupt Players (`standingsOf` in `rules/game-end.ts`, sharing `byWealth` with the winner ranking). The web `podiumOrder(players, standings)` now only maps ids to `PlayerView`s; it holds no ranking. The e2e podium spec must set `view.standings` when it fakes a game-over view.
- Every `PublicView` fixture (web tests, loadtest `bot.test.ts`, the e2e pushed view — `FullView` then, the rules `PublicView` since #71) needs a `standings` key.

## Web layout

- `WIDE_QUERY` and the `wide:` CSS variant now require `min-height: 36rem` in addition to `min-width: 48rem` + landscape. A landscape phone (852×393) keeps the phone layout.
- In the non-wide landscape branch the camera buttons move to the right edge (`landscape:` classes in `Board.tsx`) and the fit area reserves `--board-inset-right: 3.5rem` / `--board-inset-top: 0` so it is ~220 px tall. The Field card is a centered strip at the bottom (`landscape:mx-auto landscape:max-w-md`), overlaying the Board's bottom. `tabletop.spec.ts` asserts a fit area ≥ 200 px at 852×393 and opens a Field card that is not under the turn card.

## Load test

- `apps/loadtest/src/wait.ts` owns `sleep` and `withTimeout`; `runner.ts`, `worker.ts` and `docker.ts` import them (no local copies).
