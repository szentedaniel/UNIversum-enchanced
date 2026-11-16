# Ticket #328 (spectator-count review follow-ups) — decisions and gotchas

Branch `agent/issue-328-factory-review-follow-ups-324`, from main at `de384e9`. The two advisory findings of #324's review: the server never pushed a count for a spectator's own chat or refused intent, and the web's count-only push moved `seq`/`receivedAt`. No server, protocol or rules code changed.

## The lock question: fixed, not deferred

`apps/web/src/stores/room-store.ts`'s `receivePush` now recognises a count-only push and stores only `spectators`:

- `countOnlyPush(state, incoming)` requires a shown push, the same `view.version`, no `events`, no `reveals`, a view JSON-equal to the shown one, a `rematch` list JSON-equal to the shown one, **and a different `spectators` count** than `state.spectators`.
- On that push `receivePush` writes `{ spectators }` and returns: no `seq` spent, and `push.receivedAt`/`clockOffset`/`seq` untouched, so `inFlightOf` stays true and `playback-store` (which follows `roomStore.push`) is not woken.
- The count comparison is what keeps a rejoin's equal-version restatement on the ordinary path: it carries the count already shown, so it still spends a `seq` and refreshes `receivedAt` (`shows a push with the same version, as a rejoin sends the state again`).
- The `rematch` comparison is what keeps the Podium's vote push on the ordinary path: a vote changes no game state, so its push has the same view, version and count, and the moved vote list is the news (`apps/web/test/podium-rematch.test.ts`'s `replaces the votes when a vote push arrives with the same view version`).
- A same-version push with a _changed_ view still takes the ordinary path (`follows a view that changed at the same version, with no events`), and the older-version guard is unchanged (no seq spent).
- The in-flight lock's only write is still `markIntentSent`; the `holdIntent` hook in `apps/web/src/test-hooks.ts` needs no change.

Tests (`apps/web/test/room-store.test.ts`):

- `a push that only changes the spectator count > stores only the count, spending no seq and moving no push` (the same push object survives; no log line; frame stays at `eventsReached: 0`).
- `... > keeps the running Playback when only the count changes` (same core, same `eventsReached`, push object unchanged).
- `the in-flight lock > is not cleared by a push that only changes the spectator count`.
- `... > is still cleared by a Rejection after a count-only push, without the push spending a seq` (the Rejection still lands later than the shown push's `seq`).

## Server: joins and leaves only

`apps/server/test/spectators.test.ts`'s `describe("the spectator count")` gained two tests; there is **no server change** (the ticket's requirement is pinned as-is):

- `does not move for a spectator's chat or refused intent in a running game`: `GameRoom.onChat` returns early for a client without a Seat, so a spectator's chat is ignored _silently_ (no `rejected`, no `chat` broadcast), and the intent answers `SPECTATOR_READ_ONLY` to its sender alone. All three clients' `game`, `lobby` and `chat` queues are empty afterwards.
- `does not move for a spectator's chat or refused intent in a Lobby`: the same, with `Start` refused and `alice.pending("lobby")` empty; the Room's `game` stays `null`.
- `drainLobby(client)` next to `watch()` empties the stale Lobby messages a running-game setup leaves queued, so `pending("lobby")` asserts only on news. Do not use it in a Lobby test: it would hide the count push under test.

## Gotchas

- A spectator's chat is _ignored_, not refused (spec #179 puts spectator chat out of scope); do not expect `SPECTATOR_READ_ONLY` for it.
- `roomStore.push.seq` no longer moves when a watcher joins or leaves; `playback().seq` already kept its push's `seq` (#252). Both stay put now, and that is the intended e2e consequence.
- The count-only detection compares `state.spectators` with the incoming count. It is not a pure push-shape test: an equal-count restatement is a rejoin and must be accepted. A future count-only push with an unchanged count would take the ordinary path.
- `JSON.stringify` compares the views; they are JSON by construction (the same rationale as `playback-store.ts`'s `restatesView`). Property order is stable because both sides come from `publicView`.
