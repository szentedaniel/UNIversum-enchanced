# Ticket #43 (logs, metrics, monitoring profile): extension points

Branch `ticket/43-observability`. Code in `apps/server/src/observability/`.

## Logs (`observability/logger.ts`)

- `createLogger({ level, stream? })`: pino 10 NDJSON, `base: undefined` (no pid/hostname), sync stdout when no
  stream. `redact` censors (`"[redacted]"`) these keys at top level and one level down (`*.key`): guestToken,
  guestTokenHash, token, tokenHash, reconnectionToken, password, passwordHash, ip, remoteAddress, snapshot,
  **state, game, view**, `headers["x-real-ip"|"x-forwarded-for"|"x-client-ip"]`. **Gotcha: never log a field
  named `state`/`game`/`view`/`token`** for something harmless; it comes out `[redacted]` (rename it).
- `silentLogger` is the default everywhere (createGameServer, GameRoom, restoreRooms, startTestServer).
- `colyseusLogger(log)` is passed as `new Server({ logger })` (Colyseus's logger is process-global).
- Config: `logLevel` (`LOG_LEVEL`, else `info` when `NODE_ENV=production`, else `debug`), `prettyLogs`
  (= not production; main.ts dynamic-imports `pino-pretty`, a **devDependency**, absent from the image),
  `release` (`RELEASE`, default `dev`; Dockerfile `ARG RELEASE` at the end of the server stage, compose
  `build.args.RELEASE: ${RELEASE:-dev}`). #44 can reuse `config.release` for Sentry.
- GameRoom: `this.log` is a child with `roomCode` (set in `onCreate`). info: "Room created" / "Room restored"
  (`playing`, `seats`) / "Room started" / "Room ended" / "Room closed", "Seat taken" / "Seat freed" (Lobby leave) /
  "Seat dropped" (running game leave) / "Seat reconnected" (via `seatReconnected(seat)`), each with `playerId`.
  debug: "intent accepted" `{playerId, intent}` and "Rejection" `{playerId, intent, code}`. error: "Seats not
  saved" (trySave). main.ts: "Server listening", "Rooms restored", "Server ready", "Server shutting down",
  "Server stopped". restoreRooms logs "Room not restored (it stays stored)" at error (replaced `onError`).
- **#44**: engine throws / failed writes in `play`, `commit`, `timeOut` are still silent catches — add
  `this.log.error({ err, version, phase, intent }, ...)` there. `fatal` + flush on crash is yours too.

## Metrics (`observability/metrics.ts`)

- `GameMetrics` (own `Registry`, default process/event-loop metrics, `build_info{release}`). Methods:
  `trackRoom/untrackRoom(room)` (GameRoom does it in onCreate/onDispose; gauges read `room.gauges()` at scrape),
  `intentHandled(rejection|null, seconds)`, `rejected(code)` (called in `GameRoom.reject`, so it counts every
  in-Room Rejection incl. SLOW_DOWN; matchmaking refusals are NOT in `rejections_total`), `timeStoreWrite(fn)`
  (wraps `store.save` in `GameRoom.save`), `restored(n, s)` (restoreRooms with `metrics`), `seatDropped()`,
  `seatReconnected()`, `limiterRefused(limit)`.
- `rejections_total` is pre-initialised for every `REJECTION_CODES` entry; `limiter_refusals_total` for every
  `LIMITER_LIMITS` entry (room_creations_per_minute/_per_hour, joins_per_minute, sockets, seat_reservations,
  open_lobbies, live_lobbies, password_room, password_ip, intent_flood). Add a limit there first.
- `GameRoom.gauges()`: connected = Seats whose `sessionId` is in `this.clients`; held = other Seats (0 once
  ended). **#35**: if held Seats get `sessionId: null` or are tracked differently, adjust `gauges()`; call
  `this.seatReconnected(seat)` when a reconnect/rejoin lands (counter + log). `seat_drops_total` is counted in
  `onLeave` of a running game today; with `onDrop` move it there (and count Lobby drops if they are held too).
- `/metrics` served by `startInternalServer({ ..., metrics })`; Caddy falls through to the SPA for /metrics.
- Tests: `startTestServer()` returns `metrics` (fresh per server, release "test") and takes `log`;
  `captureLogs()` in test/helpers.ts gives a pino stream + `lines()`/`text()`. See `test/observability.test.ts`.

## Limiter refusals (`observability/limiter-refusals.ts`)

- `createIpTagger(now?)` → 8 hex HMAC-SHA256 of the IP bucket, random in-memory salt rotated every 24 h.
- `limiterRefused({ log, metrics, ipTag }, limit, bucket)` counts + logs info "limit refused" `{limit, ipTag}`.
- Wired: `new AbuseGuard(limits, onRefusal)` in createGameServer; the guard reports from `admitRequest`,
  `socketRefusal`, `reservationRefusal`, `creationRefusal`, `passwordAttempt`, and `guard.refused(limit, bucket,
  value)` is public (GameRoom.admit reports `intent_flood` on warn/close, bucket from `client.auth`).

## Compose `monitoring` profile

- `prometheus` (prom/prometheus:v3.15.0, 15 d retention, `monitoring/prometheus.yml`: 5 s scrape of
  `server:9464`) and `grafana` (grafana/grafana:13.2.4, provisioned datasource uid `prometheus` + dashboard uid
  `universum` from `monitoring/grafana/`, anonymous Viewer, home dashboard). Both loopback-only:
  `127.0.0.1:${PROMETHEUS_PORT:-9090}`, `127.0.0.1:${GRAFANA_PORT:-3000}`. Volumes `prometheus`, `grafana`.
  `monitoring/` is in .dockerignore (bind-mounted, not built).
- Dashboard JSON is generated-by-hand (20 panels); edit the file. #46 load test: queries for its pass criteria
  are `histogram_quantile(0.95, sum by (le) (rate(intent_duration_seconds_bucket[1m])))`, store write p99 likewise,
  `nodejs_eventloop_lag_p99_seconds`, `process_resident_memory_bytes`, `rate(process_cpu_seconds_total[1m])`.
- Verified on Docker Desktop 29.9 / Compose 5.6 with `-p t43mon`, HTTP_PORT=8043: target up, game metrics and
  `build_info{release}` in Prometheus, dashboard provisioned and querying, restart → `rooms_restored 1`, then
  `down -v`.
