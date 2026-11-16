# Ticket #332 (the spectator dashboard target and the cross-Room gauge test) — extension points and gotchas

Branch `agent/issue-332-factory-review-follow-ups-329`, from main. Review follow-ups to #329, the follow-up of #250. No production source, protocol, stored-state or logger redact change.

## What landed

- **The `spectators` gauge is on the dashboard.** `monitoring/grafana/dashboards/universum.json`'s "Connections" timeseries (panel id 9, `gridPos` x 8, y 5, w 8, h 8) keeps targets A `players_connected` ("connected") and B `seats_held_disconnected` ("held, disconnected"); #332 added target C, `refId` "C", `datasource` `prometheus`/`prometheus`, `expr` "spectators" and `legendFormat` "watching". No panel was added and no `gridPos` moved. `spectator_joins_total` stays off the dashboard: no existing panel fits a join rate.
- **`expectSeatsUnchanged(scrape, joins)`** in `apps/server/test/observability.test.ts`, next to `sample()`: one scrape's `spectator_joins_total` equals `joins`, `players_connected` is 2, `seats_held_disconnected` and `seat_drops_total` are 0. The existing spectator test calls it after the join, the drop and the leave, replacing the three repeated four-line blocks.
- **"sums the spectators across Rooms, and one leaving drops the sum by one"** in the same `describe("metrics")`: two `server.create({ maxPlayers: 2 })` Rooms, each with a second Seat and started, two spectators watching the first and one watching the second; `expect.poll` on `sample(scrape, "spectators")` for 3, then the second Room's spectator `leave()`s and the poll expects 2; the join counter ends at 3.

## Gotchas

- **The gauge is labelless, so the test carries the expected sum.** There is no per-Room series to read; the test knows how many spectators it joined and polls for that number, exactly as the existing single-Room test does. Do not add a Room-code label to the query or the scrape to make a test easier to write.
- **`expectSeatsUnchanged` also pins the join counter.** It is not a Seat metric, but the counter is part of the repeated block and its expected value differs per step, so it is the helper's second argument; callers after a join or a drop pass 1, after a leave pass 2.
- **Both Rooms are started before their spectators join.** Two connected Guests fill each `maxPlayers: 2` Room (so `players_connected` is 4 there, which is why the helper is not reused in the new test) and the spectators watch running games, the existing template; watching a Lobby is allowed too, but a started Room avoids the Lobby-disposal path.
- **Colyseus joins and leaves land asynchronously.** Both gauge reads are `expect.poll`ed, never read once, and the joins counter is asserted after the leave poll has settled so no in-flight leave can move it.
