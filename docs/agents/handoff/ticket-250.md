# Ticket #250 (spectators are counted separately in metrics and logs) — extension points and gotchas

Branch `agent/issue-250-server-spectators-are-counted-separately-in-metric`, from main at `3234f00`. Builds on #248's spectator set and #249's count; #251–#253 read what this adds. No protocol, rules, stored-state or log-redact change.

## What landed

- **`RoomGauges.spectators`** (`apps/server/src/observability/metrics.ts`): connected clients watching a Room with no Seat. `GameRoom.gauges()` fills it from `spectatorCount()` (`#spectators.size`), next to the Seat numbers.
- **Gauge `spectators`** sums `rooms().map((r) => r.spectators)` at each scrape, like `players_connected` and `seats_held_disconnected`: one server-wide number, no labels. Its `help` is "Connected clients watching a Room with no Seat.".
- **Counter `spectator_joins_total`** (labelless, help "Spectators admitted to a Room by its Room code.") with the `GameMetrics.spectatorJoined()` method in the style of `seatReconnected()`. `GameRoom.onJoin`'s `watch` branch calls it after adding the session id.
- **Logs.** `onJoin`'s `watch` branch logs info "Spectator joined" and `onLeave` logs "Spectator left" when `wasSpectator`, both as `{ spectators }` on the Room's child logger, so the line carries `roomCode` and the post-change count and no session id, name or token. The redact list is unchanged: `spectators` is not a secret key.
- **Seat numbers untouched.** `gauges().connected` is still the count of Guest Seats whose `sessionId` is a live client (`isSeatConnected`), and `held` the rest, so spectators now sharing `this.clients` (#248) cannot inflate `players_connected` or `seats_held_disconnected`. A spectator's drop and leave move no Seat counter.
- **Tests.** `apps/server/test/observability.test.ts`: "counts spectators apart from the Seats, and none of their comings and goings moves a Seat metric" (gauge 0 → 1 → 0 on join, drop and leave, `spectator_joins_total` 1 then 2, unchanged `players_connected`/`seats_held_disconnected`/`seat_drops_total`, gauge and counter HELP/TYPE lines, a spectator's Roll rejected with `SPECTATOR_READ_ONLY` not sampled by `intent_duration_seconds_count` or `intents_total`) and, under `logs`, "say a spectator joined or left with the count and the Room code, never its session id".

## Gotchas

- **The line's count is the count after the change.** "Spectator joined" carries the count including the newcomer; "Spectator left" the count without the leaver. A following `broadcastSpectatorCount()` push carries the same number.
- **A dropped spectator logs "Spectator left".** `onDrop` finds no Seat and returns, so Colyseus calls `onLeave` straight away; there is no Seat hold and no reconnection.
- **Shutdown logs no "Spectator left" line.** `onLeave` deletes the session id before the `#shuttingDown` return, but the line sits after that return, as the Seat lines do.
- **An ended Room's watchers still count.** `gauges().spectators` does not look at `state` (only `held` does), so a Podium's spectators stay in the gauge until the Room is deleted — the same rule `players_connected` follows for connected Seats.
- **No per-spectator labels anywhere.** The gauge and the counter are labelless on purpose: a label per spectator would put an unbounded set of identities in the scrape, so the series stay server-wide numbers.
- **The Grafana dashboard has no spectator panel.** `monitoring/grafana/dashboards/universum.json`'s "Connections" panel still queries only `players_connected` and `seats_held_disconnected`; a later ticket that wants operators to see the new series adds it there.
- **The web does not read any of this.** #251–#253 own the spectator count and role on the client; nothing on the client side changed here.
