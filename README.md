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

Manual check after packaging changes: run `docker compose up --build`, open http://localhost in two
browsers (e.g. a desktop browser and a phone on the LAN at `http://<this machine's IP>`), create a
Room in one, join it with the Room code in the other, start, and play a few Turns.
