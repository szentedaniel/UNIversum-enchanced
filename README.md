# UNIversum

Read the full documentation [_**here**_](/docs/2122_2_SzenteDa%CC%81niel_A1A9CA_Szakdolgozat_VP.pdf)

---

## Abstract

The aim of my Thesis is the creation of a simple Monopoly-like game, in which,
at most four players can play at a time with each other, while also having the ability
to create lobbies, where they can invite one another.

The implementation was made by web technologies. The backend is provided by
an Express server, using a Node.js engine. The communication takes place through
websockets, via a module named Socket.io.
The frontend is the most popular JavaScript library nowadays called React JS.

The game is displayed in an izometric view, this way, it is easier to view and more
transparent. Also, in most cases, players prefer this view in such games. The
graphics elements are rendered by a HTML5 Creation Engine called PixiJS.
Regarding the visuals of the game, it was made in modern and clean design, which
has gained plenty of popularity recently, and boasting an ever-growing playerbase.

## Development (v2)

v1 lives untouched in `v1/` as the rules reference. v2 is a pnpm workspace:
`apps/web`, `apps/server`, `apps/e2e`, `apps/loadtest`, `packages/rules` and `packages/protocol`.

Needs Node 26 (`.node-version`) and pnpm 12 (`packageManager`).

```sh
pnpm install
pnpm dev            # Room server (node --watch) + Vite on http://localhost:5173
pnpm dev --host     # the same, reachable from a phone on the LAN
```

Settings come from the environment with dev defaults; copy `.env.example` to `.env` to override them.

Checks, as CI runs them: `pnpm fmt:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm e2e`.

## Running with Docker (v2)

Needs only Docker with Compose. One `Dockerfile` builds two images: `server` (the Room server on
`node:26-slim`, run from its TypeScript source) and `web` (Caddy serving the Vite build and proxying
`/colyseus/*` to the server). The server port is never published; SQLite lives on the `data` volume.

```sh
docker compose up --build -d   # the app on http://localhost
docker compose logs -f         # logs (rotated by Docker: 5 × 20 MB per container)
docker compose down            # stop; add -v to also delete the saved Rooms
```

Overrides go in `.env` (see `.env.example`), e.g. `HTTP_PORT=8080` when port 80 is taken.

The server logs NDJSON (pino) on stdout: `info` in the image, `debug` under `pnpm dev` (pretty-printed),
`LOG_LEVEL` overrides. Metrics are on the internal port at `/metrics` (with `/healthz` and `/readyz`),
which is never published nor routed by Caddy. To build with the git SHA as the release
(`build_info{release}`): `RELEASE=$(git rev-parse --short HEAD) docker compose build`.

Error reporting is off unless `SENTRY_DSN` is set in `.env` (any Sentry-protocol tracker). The
server then reports engine failures and crashes, and the browser sends its errors through `/errors`;
the tunnel strips the IP and every token before forwarding. With no DSN, neither SDK sends anything.

### Monitoring (opt-in)

```sh
docker compose --profile monitoring up -d   # + Prometheus (5 s scrape) and Grafana
```

Grafana opens the provisioned "UNIversum server" dashboard at http://127.0.0.1:3000 (read-only
without login; admin password `GRAFANA_ADMIN_PASSWORD`, default `admin`), Prometheus is at
http://127.0.0.1:9090. Both listen on loopback only; `GRAFANA_PORT` / `PROMETHEUS_PORT` move them.
Prometheus keeps 15 days. The dashboard is `monitoring/grafana/dashboards/universum.json`: edit the
file, not the UI. A plain `docker compose up` starts neither, and `docker compose down` needs
`--profile monitoring` to stop them.

Manual check after packaging changes: run `docker compose up --build`, open http://localhost in two
browsers (e.g. a desktop browser and a phone on the LAN at `http://<this machine's IP>`), create a
Room in one, join it with the Room code in the other, start, and play a few Turns.

## Load test (manual, never in CI)

`pnpm loadtest` proves the launch peak: it brings up the compose stack with
`compose.loadtest.yaml` (the server capped at 2 CPUs / 2 GB, per-IP limits raised, flood limits,
`maxPayload` and the Lobby cap at production values) and the `monitoring` profile, runs 1,000
scripted Rooms of 4 over a 10-minute ramp and a 30-minute hold, SIGKILLs the server 20 minutes into
the hold, and prints PASS/FAIL per criterion from Prometheus plus the generator's own round-trip
and Seat/version checks. It writes a Markdown report to `loadtest-reports/` (gitignored) and exits
non-zero on any FAIL.

The generator runs on the host, outside the container caps; a run where the generator itself uses
more than 70% of the machine is marked invalid. A passing 40-minute run on a Linux host is the
sign-off (#47); for a quick scaled smoke on a laptop:

```sh
pnpm loadtest -- --rooms 20 --ramp 1m --hold 2m --restart-at 1m \
  --http-port 9146 --prometheus-port 9190 --grafana-port 9300 --project loadtest-smoke
```

The `--` is optional (`pnpm loadtest --rooms 20 …` works too); pnpm forwards it to the script and
the parser ignores it.

`pnpm loadtest -- --help` lists every option, including `--find-knee` (adds 100 Rooms/min until a
threshold breaks and reports the last passing count; it never gates), `--no-build` and `--keep`.
CI only type-checks and lints `apps/loadtest`; it never runs the load.

## Third-party content

The Room name word filter (`apps/server/src/room/blocked-words.ts`) is seeded from the
[List of Dirty, Naughty, Obscene and Otherwise Bad Words](https://github.com/LDNOOBW/List-of-Dirty-Naughty-Obscene-and-Otherwise-Bad-Words)
(LDNOOBW contributors, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)). Changes: some
entries were removed and hu/de words, stems and a whitelist were added (listed in that file and in
`word-filter.ts`).
