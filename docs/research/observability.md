# Research: $0 self-hosted observability for v2

Ticket: #18, part of the map #1 (UNIversum v2 modernization). Feeds Decide the v2 observability (#20).
Researched on **2026-10-18** (finished 2026-10-19). Versions and licences come from the npm registry, GitHub/GitLab APIs and each project's own docs on those dates. This note lists options and trade-offs. It does not make the decision.

## Question

Which $0, self-hosted, provider-independent observability fits v2? The v2 stack is Node 26 + Colyseus 0.18 server and a Vite + React 19 client, run with docker compose on one Linux box and horizontally scalable later. The note covers errors, logs, metrics, client-side telemetry and privacy, and the game-specific signals worth having.

Constraints that matter here (map #1 Notes, ADR-0002, #9):

- **$0.** Everything must be free to run and self-hostable.
- **Provider-independent.** `docker compose up` must work on any Linux box.
- **Light.** One small box running ~1,000 Rooms / ~4,000 Players at peak, so observability must not eat the server's RAM.
- **Scales 10×.** Later there are several Room server processes behind Redis presence and Postgres.
- **Guests, no accounts.** The Guest token is a 128-bit secret in `localStorage` that lets a Guest reclaim a Seat. Only its hash is stored. The Room server sits behind Caddy.

## Summary

| Area | Options | Lightest $0 fit | Main trade-off |
|---|---|---|---|
| Errors | Bugsink, GlitchTip, Sentry self-hosted, none | Bugsink (1 container) or GlitchTip (app + Postgres) | Bugsink is source-available (PolyForm Shield), not OSI open source. GlitchTip is MIT but needs Postgres. Sentry needs ≥ 7 GB RAM even in errors-only mode. |
| Logs | pino → stdout → `docker logs`; + Loki/Alloy; + Vector | pino to stdout with the `local` Docker log driver | Loki/Grafana add search and alerting, but add containers and are AGPL. |
| Metrics | `@prometheus-io/client` (ex-`prom-client`), OpenTelemetry metrics, Colyseus stats/monitor | Prometheus client + `/metrics`; Prometheus + Grafana opt-in | OTel is vendor-neutral, but its SDK packages are 0.x and ESM auto-instrumentation needs a loader hook. |
| Client | Sentry browser SDK → self-hosted DSN; own tiny `/client-errors` endpoint; nothing | Count disconnects and reconnects on the **server** (no browser telemetry) | Browser error reports carry the IP and possibly identifiers, which needs GDPR care. |

## Errors: Sentry-protocol trackers

All three accept events from the official Sentry SDKs (`@sentry/node`, `@sentry/browser`/`@sentry/react`, currently **11.8.0**, MIT, npm 2026-10-15), so the app code is the same whichever one is chosen. Only the DSN changes. Making it **opt-in through a DSN env var** is cheap: with no DSN, `Sentry.init` is skipped and errors still reach the logs.

### Bugsink

- **Version:** 2.6.1 (tag 2026-09-25, [github.com/bugsink/bugsink](https://github.com/bugsink/bugsink)).
- **Licence:** **PolyForm Shield 1.0.0** for the core ([LICENSE](https://raw.githubusercontent.com/bugsink/bugsink/main/LICENSE)). It is free to self-host, but it is source-available, not OSI open source: the licence forbids using it to compete with the licensor. That doesn't affect running it for a game.
- **Footprint:** one container or one Python process. Docker uses SQLite by default when `DATABASE_URL` is unset. MySQL is the recommended production database, and Postgres is supported but "not extensively tested" ([Docker install](https://www.bugsink.com/docs/docker-install/)). The single-server guide says "a single cheap server can handle up to 1.5 million events per day", with Gunicorn workers running "(far) below 100MiB per worker", and 10 workers fit in 2 GB ([single-server production](https://www.bugsink.com/docs/single-server-production/)). Fewer workers fit a small box.
- **Caveat:** Bugsink states that "Docker volumes do not provide the necessary guarantees for SQLite in WAL-mode … Hence: not recommended" ([Docker install](https://www.bugsink.com/docs/docker-install/)). SQLite's own docs say only that WAL needs every process on the same host and does not work over a network filesystem ([sqlite.org/wal](https://sqlite.org/wal.html)). This is also relevant to v2's own SQLite `RoomStore` on a volume (ADR-0002). A local named volume on Linux is a local directory, so the SQLite condition holds. Bugsink's warning is broader than SQLite's rule, and the spec should state the assumption: local volume, one writer process.
- **Source maps:** debug-ID based, uploaded with `sentry-cli sourcemaps inject` + `upload`. It needs Bugsink ≥ 2.0.14. "Fetching scripts from URLs is deliberately unsupported" ([Bugsink sourcemaps](https://www.bugsink.com/docs/sourcemaps/)).
- **Scope:** errors only. Its Sentry-compatibility page doesn't document tracing, sessions, replays or logs ([sentry-sdk-compatible](https://www.bugsink.com/sentry-sdk-compatible/)). Treat them as unsupported.

### GlitchTip

- **Version:** 6.2.6 (tag 2026-08-07, GitLab `glitchtip/glitchtip-backend`).
- **Licence:** **MIT** (GitLab project metadata).
- **Footprint:** "Recommended system requirements: 512 MB RAM … Minimum … 256 MB RAM when using all-in-one setup". With careful configuration it goes down to 128 MB plus swap. It needs **PostgreSQL 14+** (mandatory) and Valkey/Redis 7+ (optional but recommended). `GLITCHTIP_EMBED_WORKER` runs the worker inside the web container. Disk: "a 1 million event per month instance may require 30GB" ([install](https://glitchtip.com/documentation/install)).
- **Features:** error tracking, performance, uptime monitoring and **logs** through the Sentry SDK logs API. Logs stay hot in Postgres for 7 days and are kept 90 days by default (`GLITCHTIP_LOG_RETENTION_DAYS`, `GLITCHTIP_LOG_HOT_DAYS`) ([logs](https://glitchtip.com/documentation/logs)).
- **Source maps:** `glitchtip-cli sourcemaps inject ./dist` + `upload ./dist` (CLI in beta) ([error tracking](https://glitchtip.com/documentation/error-tracking), [CLI](https://glitchtip.com/documentation/cli)). The docs don't say whether `@sentry/vite-plugin` / `sentry-cli` upload works against GlitchTip. **Unverified.**

### Sentry self-hosted

- **Version:** 26.10.0 (2026-10-16, [getsentry/self-hosted](https://github.com/getsentry/self-hosted)).
- **Licence:** **FSL-1.1-Apache-2.0** (Fair Source). It becomes Apache 2.0 after 2 years ([develop.sentry.dev/self-hosted](https://develop.sentry.dev/self-hosted/), [sentry LICENSE](https://raw.githubusercontent.com/getsentry/sentry/master/LICENSE.md)).
- **Footprint:** minimum 4 cores and 16 GB RAM + 16 GB swap, 32 GB recommended, 20 GB disk ([develop.sentry.dev/self-hosted](https://develop.sentry.dev/self-hosted/)). The installer's hard floor is **14,000 MB / 4 CPU**, or **7,000 MB / 2 CPU** with `COMPOSE_PROFILES=errors-only` ([install/_min-requirements.sh](https://raw.githubusercontent.com/getsentry/self-hosted/master/install/_min-requirements.sh), [.env](https://raw.githubusercontent.com/getsentry/self-hosted/master/.env)). The compose file defines 53 services, and 25 of them are gated to `feature-complete`, so errors-only still runs ~28: Kafka, ClickHouse, Snuba, Relay, Symbolicator and others (my count of [docker-compose.yml](https://raw.githubusercontent.com/getsentry/self-hosted/master/docker-compose.yml)).
- **Verdict on fit:** the most complete product, but it would be bigger than the game server it watches. It doesn't fit a "small box, `docker compose up`" constraint.

### No dedicated tracker

Log errors with pino (`err` serializer, stack included) and rely on log search and alerting (Loki) or `docker logs | grep`. It costs zero extra containers, but there is no grouping, de-duplication or release tracking, and browser errors still need somewhere to go.

### Source maps per side

- **Server (`.ts` under type stripping):** none needed. "Since inline types are replaced by whitespace, source maps are unnecessary for correct line numbers in stack traces; and Node.js does not generate them" ([Node TypeScript docs](https://nodejs.org/api/typescript.html), Stable). Stack frames point at the real `.ts` lines in the image.
- **Client (Vite):** build with `build.sourcemap: 'hidden'` and inject debug IDs. Then either use `@sentry/vite-plugin` (set its `url` to the self-hosted instance, `sourcemaps.filesToDeleteAfterUpload` so maps are not served publicly) ([Sentry Vite guide](https://docs.sentry.io/platforms/javascript/sourcemaps/uploading/vite/)), or run `sentry-cli` / `glitchtip-cli` as a CI step. `@sentry/cli` 3.8.0 is licensed **FSL-1.1-MIT**, free to use (npm). Uploading needs the tracker reachable from CI, which conflicts a little with "runs locally": with no tracker, the upload step is skipped.

### Sentry SDK on Node 26

- **Engines:** `>=20.19 <22 || >=22.12 <23 || >=23.2`, so Node 26 is fine. ESM apps load it with `node --import ./instrument.js app.js` ([Sentry Node ESM](https://docs.sentry.io/platforms/javascript/guides/node/install/esm/)).
- **Weight:** `@sentry/node` 11 depends on `@opentelemetry/api` and `@sentry/opentelemetry` (npm), so it brings OTel in even for errors only.
- **Colyseus hook:** Colyseus 0.18's `Room.onUncaughtException` wraps message handlers and timers (`@colyseus/core` 0.18.19 `build/Room.mjs`), which gives one place to `captureException`.

## Logs

### Library

- **pino 10.4.0** (MIT, 2026-10-02).
  - **Output:** NDJSON, with numeric `level` (10–60), `time`, `pid`, `hostname`, `msg`. It has child loggers (`logger.child({ room })`) and an `err` serializer.
  - **Redaction:** the `redact` option takes paths and a censor or remove ([pino API](https://github.com/pinojs/pino/blob/main/docs/api.md)), and suits fields like `guestToken`, `password`, `passwordHash` and `ip`.
  - **Transports:** these run in a worker thread. The docs recommend doing transformation and shipping "either in a separate thread or a separate process". `pino-loki` and `pino-opentelemetry-transport` exist ([pino transports](https://github.com/pinojs/pino/blob/main/docs/transports.md)). `pino-pretty` 13.2.0 is for dev only.
- **Built-ins:** Node has no structured logger, only `console` and `util.debuglog`. Colyseus logs through `console` by default and accepts a replacement via `new Server({ logger })` (`setLogger` in `@colyseus/core` 0.18.19 `build/Server.mjs`), so pino can take over Colyseus's own logs too. Its `debug("colyseus:*")` channels are separate.

### Where logs go under docker compose

1. **stdout + `docker logs`** costs $0 and nothing extra. Docker's default `json-file` driver does **no rotation**: `max-size` defaults to −1 (unlimited). Docker recommends the `local` driver, which rotates by default, or `max-size`/`max-file` options ([Docker logging](https://docs.docker.com/engine/logging/configure/), [json-file](https://docs.docker.com/engine/logging/drivers/json-file/)). Retention then lives in compose config, which also covers GDPR storage limitation.
2. **+ Loki + Grafana Alloy** gives searchable logs and alert rules in Grafana.
   - **Loki:** 3.7.8 (2026-09-17), **AGPL-3.0**. Monolithic mode suits "small read/write volumes of up to approximately 20GB per day" ([deployment modes](https://grafana.com/docs/loki/latest/get-started/deployment-modes/)).
   - **Promtail** is EOL as of 2026-03-02, and Alloy is the replacement ([Promtail](https://grafana.com/docs/loki/latest/send-data/promtail/)). **Alloy** 1.20.1 is Apache-2.0 and reads Docker container logs.
3. **+ Vector** 0.59.0 (2026-10-06, MPL-2.0) is a single-binary router. It can tail Docker logs, redact or sample, and ship to Loki or files. It fits only if logs need transforming outside the app.
4. **GlitchTip logs:** if GlitchTip is chosen, the Sentry logs API can feed it, so one tool covers errors and logs. The trade-off is Postgres growth and coupling logs to the error tracker.

## Metrics

### Prometheus client

`prom-client` is **deprecated on npm**: "prom-client has been replaced by @prometheus-io/client" (15.1.3, last published 2024-06-27). The project moved into the Prometheus org as **`@prometheus-io/client` 0.16.1** (2026-08-27, Apache-2.0, `engines.node: ^22 || ^24 || >=26`) ([prometheus/client_js](https://github.com/prometheus/client_js), v0.16.0 release notes).

- **Default metrics:** event-loop lag, GC, heap, handles, plus Linux-only FD and memory metrics.
- **Types:** Counter, Gauge, Histogram, Summary. Prometheus 0.0.4 and OpenMetrics output, with exemplars.
- **Workers:** cluster and worker-thread aggregation. 0.16 reports 15–35% faster metric ops ([README](https://github.com/prometheus/client_js), [v0.16.0](https://github.com/prometheus/client_js/releases/tag/v0.16.0)).
- **Endpoint:** it bundles no web framework. You serve `await registry.metrics()` yourself, which Colyseus's `createRouter` can do.

### OpenTelemetry JS

- **Status:** Traces **Stable**, Metrics **Stable**, Logs **Development**. Browser instrumentation is "experimental and mostly unspecified" ([opentelemetry.io/docs/languages/js](https://opentelemetry.io/docs/languages/js/)). Node 26, 24 and 22 are supported ([opentelemetry-js README](https://github.com/open-telemetry/opentelemetry-js)).
- **Versions:** stable packages (`sdk-metrics`, `sdk-trace-node`) are at **2.12.0** and `@opentelemetry/api` at 1.9.1. `sdk-node`, `sdk-logs`, `exporter-prometheus` and `instrumentation` are still **0.223.0** (experimental track), and `auto-instrumentations-node` is 0.81.2 (npm, 2026-10-13/16).
- **ESM caveat:** auto-instrumentation of ESM needs `--experimental-loader=@opentelemetry/instrumentation/hook.mjs`, and "because of ongoing issues with loaders running TypeScript code as ESM … results may vary" ([esm-support.md](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md)). v2 is ESM `.ts` under type stripping, so that's exactly the risky case. Using only the metrics API plus a Prometheus exporter needs no loader hook.
- **Value here is limited:** auto-instrumentation covers HTTP and DB clients, not Colyseus WebSocket messages, so every game signal is manual code either way. OTel's payoff is portability to an OTLP backend later. Its cost is 0.x churn.
- **Overhead:** I found no official overhead figure for Node.

### What Colyseus 0.18 exposes

From `@colyseus/core` 0.18.19 and `@colyseus/monitor` 0.18.6, both MIT and read from the published packages:

- **`matchMaker.stats`:** `stats.local.roomCount` and `stats.local.ccu` per process, and `stats.getGlobalCCU()` / `fetchAll()` across processes via presence (persisted at most once a second). These are the "live Rooms" and "connected clients" counters for free. They are also registered as `@pm2/io` metrics if that package is installed.
- **No built-in Prometheus endpoint**, and no message-rate, latency or bytes stats.
- **`@colyseus/monitor`:** an admin UI at `/monitor` and a JSON `/monitor/api` (room list, host CPU and memory via `node-os-utils`, process RSS). It can inspect Room state, dispose Rooms, disconnect clients and send messages. The docs warn: "Do not expose it in production without password protection" (use `basicAuth`) ([Colyseus monitoring](https://docs.colyseus.io/tools/monitoring)). It's useful for debugging. It isn't a metrics system, and it reveals Room state, including Seats.
- **Server `Room` hooks:** `onDrop` and `onReconnect` (with `allowReconnection`), `onLeave`, `onUncaughtException`. These let the server count disconnects and reconnects itself.

### Prometheus + Grafana in compose

- **Prometheus** 3.15.0 (2026-09-25, Apache-2.0).
  - **Retention:** 15 days by default, set with `--storage.tsdb.retention.time` / `.size`. It keeps "1-2 bytes per sample", with a 2-hour head block in memory ([storage](https://prometheus.io/docs/prometheus/latest/storage/)).
  - **Sizing (my arithmetic):** ~1,500 series at a 15 s scrape is 100 samples/s × 2 B × 15 d ≈ **260 MB of disk**.
  - **Labels:** "Do not use labels to store dimensions with high cardinality … such as user IDs" ([naming](https://prometheus.io/docs/practices/naming/)). So **never label by Room code, Guest or Player**. Label only by intent type, Rejection code and phase.
  - **Scaling out:** several Room server processes are found via Prometheus `docker_sd_configs` or static targets.
- **Grafana** 13.2.4 (2026-10-13, **AGPL-3.0**). Minimum recommended is 512 MB RAM and 1 core. It uses embedded SQLite by default ([install](https://grafana.com/docs/grafana/latest/setup-grafana/installation/)). Dashboards and datasources can ship in the repo as provisioning files.
- **Minimal stack:** Prometheus + Grafana (+ Loki + Alloy for logs) is 2–4 extra containers. Grafana publishes a 512 MB floor. Prometheus and Loki publish no RAM minimums, so measure before deciding (see open questions).
- **Profiles:** a compose `profiles: [observability]` keeps them out of a plain `docker compose up`.
- **AGPL:** this matters only if Grafana or Loki is modified and offered to others, not for internal use.
- **Lighter alternatives:** VictoriaMetrics single-node (v1.154.0, Apache-2.0) is a drop-in Prometheus-compatible store, and VictoriaLogs (v1.53.0) does the same for logs. The trade-offs are fewer docs and a smaller ecosystem than Prometheus/Loki.

## Client side

### Errors

- **(a) `@sentry/react` / `@sentry/browser` → self-hosted DSN:** gives grouping and source maps.
- **(b) A ~30-line reporter:** `window` `error` / `unhandledrejection` POSTs to the Room server, and pino logs it. No new service, but no grouping.
- **(c) Nothing.**

With (a), the `tunnel` option sends events to an own endpoint that forwards them to the tracker. That beats ad-blockers and gives one place to strip data ([Sentry tunnel](https://docs.sentry.io/platforms/javascript/troubleshooting/#using-the-tunnel-option)).

### Disconnects and reconnects

These need **no browser telemetry**. The server sees every drop and reconnect (`onDrop` / `onReconnect`, `onLeave` with close code) and can count them as metrics. The client SDK (`@colyseus/sdk` 0.18.5) exposes `room.onDrop`, `room.onReconnect`, `room.onLeave(code)` and `reconnection` options (`maxRetries`, `minDelay`, `maxDelay`) (`build/Room.d.ts`, `build/Reconnection.d.ts`). Only "gave up reconnecting" is invisible to the server. It can be approximated by Seats never reclaimed before the game ends.

### Privacy: Guest token, IP, GDPR

- **IP addresses are personal data.** CJEU *Breyer* (C-582/14): a dynamic IP address is personal data for a site operator that has legal means to identify the person. "Ensuring the general operability" of the service can be a legitimate interest ([EUR-Lex C-582/14](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62014CJ0582)). GDPR Recital 49 names processing "strictly necessary and proportionate for … network and information security" as a legitimate interest. Art. 5(1)(c) (data minimisation) and 5(1)(e) (storage limitation) apply to logs and error events ([GDPR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679)).
- **Sentry SDK defaults:** with `dataCollection.userInfo` (default `true` when `dataCollection` is set), the browser SDK sets `ip_address: "{{auto}}"`, and Sentry "will infer the IP address from the connection" ([options](https://docs.sentry.io/platforms/javascript/configuration/options/), [identify user](https://docs.sentry.io/platforms/javascript/enriching-events/identify-user/)). To avoid that, set `userInfo: false`, strip in `beforeSend`, and/or use the tunnel (the tracker then sees the server's IP). **Not verified:** whether GlitchTip and Bugsink honour `{{auto}}` or store the ingest IP.
- **Guest token:** the raw token must never reach logs, metrics or error events. It's sent only at join (#9), so redact join options in pino and in `beforeSend`, and never set it as Sentry `user.id`. Even its hash is a stable pseudonymous identifier, so a public Player id or nothing is the safer tag.
- **Caddy:** access logs are **off by default**. If they're enabled, the `ip_mask` filter truncates `remote_ip`/`client_ip`, and rolled files default to 90 days / 10 files ([Caddy log](https://caddyserver.com/docs/caddyfile/directives/log)).
- **ePrivacy Art. 5(3):** EDPB Guidelines 2/2023 (final 2024-10-16) treat **local storage** like cookies when information is read from the device ([PDF](https://www.edpb.europa.eu/system/files/documents/2024-10/edpb_guidelines_202302_technical_scope_art_53_eprivacydirective_v2_en_0.pdf), passage on web browsers storing "cookies, local storage, WebSQL"). The Guest token is needed to give the Guest the reconnect they asked for, which plausibly fits the "strictly necessary" exemption. A separate telemetry identifier, such as Sentry session or replay IDs, would not. So keep error reporting free of device identifiers, and turn off sessions and replay.

## Game-specific signals

Candidate metrics, all low-cardinality:

| Signal | Type | Source |
|---|---|---|
| Live Rooms (by phase: Lobby / playing) | Gauge | `matchMaker.stats.local.roomCount`, plus own phase count |
| Connected Players / CCU | Gauge | `stats.local.ccu`; global via `getGlobalCCU()` |
| Intent latency (receive → validated → `apply` → store write → broadcast) | Histogram, label `intent` | own timing with `performance.now()` |
| Rejections | Counter, label `code` | the `Rejection` return of `apply` |
| Zod validation failures | Counter | intent entry point |
| SQLite (`RoomStore`) write latency | Histogram | around the write in the save-after-every-intent path |
| Room restore on boot (count, duration, failures) | Gauge/Histogram | boot restore loop |
| Drops / reconnects / Seats expired | Counters | `onDrop`, `onReconnect`, Lobby 60 s Seat release |
| Deadlines fired late (catch-up after downtime) | Counter | deadline scheduler |
| Node runtime (event-loop lag, heap, GC) | default | `collectDefaultMetrics()` |

These come to well under ~1,500 series. Room code, Guest and Player must never be labels; they belong in logs, if anywhere.

## Option bundles for #20

| Bundle | Extra containers | RAM floor (published) | Gets you | Misses |
|---|---|---|---|---|
| **A. Logs + metrics endpoint only:** pino → stdout (`local` driver), `/metrics` served, Colyseus monitor behind basic auth | 0 | 0 | Structured logs, scrapeable metrics, debug UI | No dashboards, no error grouping, no browser errors |
| **B. A + opt-in error DSN:** Sentry SDK on both sides, inactive without `SENTRY_DSN`. Bugsink or GlitchTip in a compose profile | 1 (Bugsink) or 2 (GlitchTip + Postgres) | Bugsink: unpublished, <100 MiB per worker. GlitchTip: 256–512 MB + Postgres | Grouped server and browser errors with source maps | Dashboards |
| **C. B + Prometheus + Grafana profile**, dashboards provisioned from the repo | +2 | Grafana 512 MB, Prometheus unpublished | Live Rooms, CCU, latency and Rejection dashboards | Log search |
| **D. C + Loki + Alloy** | +2 | unpublished | Log search and alerts in one Grafana | Most moving parts, AGPL components |
| **E. Sentry self-hosted** | ~28 (errors-only) | 7 GB / 2 CPU hard floor | Most complete error product | Bigger than the game server; fails the "light" constraint |

OpenTelemetry is an implementation choice inside A–D: use the OTel metrics API with a Prometheus exporter instead of `@prometheus-io/client`. It isn't a separate bundle.

## Open questions for Decide the v2 observability (#20)

1. **Error tracker in compose:** is one in the default `docker compose up`, in an opt-in profile, or absent with only a DSN env var? Also, is Bugsink's PolyForm Shield (source-available) acceptable, or must it be OSI open source (GlitchTip, which adds Postgres)?
2. **Browser errors:** do they go to the tracker (Sentry SDK + tunnel), to an own `/client-errors` endpoint, or nowhere? Are disconnect and reconnect rates counted server-side only?
3. **Metrics library:** `@prometheus-io/client` directly, or the OTel metrics API (stable 2.x SDK, 0.x exporter)? No ESM auto-instrumentation either way?
4. **Dashboards:** do Grafana dashboards and Prometheus config ship in the repo (provisioned), and under which compose profile?
5. **Never-log list and retention:** Guest token, its hash, passwords and hashes, raw IPs, join options. What are the retention limits for logs (Docker `local` driver size), error events and metrics (15 days by default)?
6. **Colyseus monitor:** is it mounted in production at all? It can dispose Rooms and shows Seats and state.
7. **SQLite on a volume:** Bugsink's "not recommended" warning about SQLite WAL on Docker volumes also touches the v2 `RoomStore`. Should the spec state "local volume, single writer" explicitly?

## Not established

- Actual RAM of Bugsink, GlitchTip, Prometheus, Grafana and Loki under this workload. Only published floors are quoted, and Docker wasn't running to measure.
- Whether `@sentry/vite-plugin` / `sentry-cli` debug-ID uploads work against GlitchTip (its docs show only `glitchtip-cli`).
- Whether GlitchTip and Bugsink store the ingest IP when the SDK sends `{{auto}}`, and whether they can scrub it server-side.
- An official overhead figure for OpenTelemetry JS on Node.
- Whether Sentry SDK 11 features beyond errors (logs, sessions) work against Bugsink. Its docs don't say.

## Sources

npm registry metadata (2026-10-18/19) for pino, pino-pretty, prom-client, @prometheus-io/client, @opentelemetry/*, @colyseus/core, @colyseus/monitor, @colyseus/sdk, @sentry/*. GitHub API for releases and licences: grafana/grafana, grafana/loki, grafana/alloy, prometheus/prometheus, prometheus/client_js, vectordotdev/vector, VictoriaMetrics, getsentry/self-hosted, bugsink/bugsink. GitLab API for glitchtip/glitchtip-backend. The Colyseus package sources (`@colyseus/core` 0.18.19 `build/Stats.mjs`, `build/Server.mjs`, `build/Room.mjs`; `@colyseus/monitor` 0.18.6 `src-backend/index.ts`; `@colyseus/sdk` 0.18.5 `build/Room.d.ts`) were read from the published tarballs. All other sources are linked inline.
