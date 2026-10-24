# Ticket #23 (workspace/CI prefactor) — facts for later tickets

Branch `ticket/23-workspace`. All checks verified locally on macOS, Node 26.11.1, pnpm 12.14.0.

## Layout

- `v1/client`, `v1/server` (pure `git mv`, untouched). `v1/server/.env` is still tracked there.
- `apps/web` (@universum/web), `apps/server` (@universum/server), `apps/e2e` (@universum/e2e),
  `apps/loadtest` (@universum/loadtest), `packages/rules` (@universum/rules), `packages/protocol` (@universum/protocol).
- Every package has `"imports": {"#*": "./src/*"}` → `import { x } from "#foo.ts"`. Web also has `#assets/*` → `./assets/*`.
- rules exports `.` and `./board`; protocol exports `.` and `./messages` (the Zod-free subpath). Both `.ts` source, no build.

## Versions (pnpm catalog in pnpm-workspace.yaml, exact pins)

typescript 7.0.2 (stable `typescript` package, native Go `tsc`; no `@typescript/native-preview` needed),
oxlint 1.88.0 + oxlint-tsgolint 7.0.2004, oxfmt 0.73.0, vite 8.3.4, @vitejs/plugin-react 6.1.2,
react/react-dom 19.3.1, @types/react(-dom) 19.3.0, vitest 5.0.5, @playwright/test 1.64.1,
@colyseus/core 0.18.19, @colyseus/ws-transport 0.18.4, @colyseus/sdk 0.18.5, zod 4.6.7, @types/node 26.6.5.
Not yet in catalog: react-router, zustand, pixi.js, pino, paraglide, tailwind, etc.

## Gotchas

- pnpm 12 blocks unapproved build scripts (`ERR_PNPM_IGNORED_BUILDS`). `msgpackr-extract` (optional native
  speed-up of msgpackr, pulled by @colyseus/core) is denied via `allowBuilds: { msgpackr-extract: false }`.
  Revisit for the load test if msgpack encoding is hot.
- Use `@colyseus/core` + `@colyseus/ws-transport` directly; the `colyseus` meta package drags in monitor,
  playground, redis. Core lists `@colyseus/schema` as a peer but boots fine without it.
- Colyseus HTTP matchmaking lives at `/matchmake/*`, health at `/__healthcheck`; the WS path regex only looks at
  the last two path segments, so a prefix works. Vite proxies `/colyseus/*` → `http://127.0.0.1:$PORT/*`
  (prefix stripped, `ws: true`), in both `server.proxy` and `preview.proxy`. Client: `new Client("/colyseus")`
  (SDK resolves a leading `/` against `window.location`). Caddy should do the same (`handle_path /colyseus/*`).
- A room-less WebSocket to Colyseus gets a 1-byte PING reply to any message (used by the e2e smoke test).
- Vite's SPA fallback answers unknown paths with index.html + 200 — assert response bodies, not just status.
- Oxlint `no-restricted-imports` `regex` patterns are Rust regex: **no lookahead**. Use gitignore-style
  `group: ["@universum/rules/*", "!@universum/rules/board"]` instead.
- Oxlint `ignorePatterns` are NOT lifted by `--no-ignore` for explicit paths.
- Oxlint type-check picks the nearest `tsconfig.json`; the web app's is a solution file referencing
  `tsconfig.app.json` (src, DOM, bundler resolution) and `tsconfig.node.json` (vite.config.ts, test/).
- Web uses `moduleResolution: bundler`, so TS doesn't force extensions there; `import/extensions` (oxlint) does.
- `node --env-file-if-exists=../../.env` prints "not found. Continuing without it." when no .env exists (harmless).
- `pnpm dev --host` appends `--host` to both packages' dev scripts; Vite binds the LAN, the server ignores it and
  stays on 127.0.0.1 (verified: LAN :5173 proxies OK, :2567 unreachable from LAN).

## Commands (all green locally)

`pnpm install --frozen-lockfile`, `pnpm exec oxfmt --check`, `pnpm exec oxlint --type-aware --type-check`,
`pnpm -r run typecheck`, `pnpm exec vitest run` (root config lists the projects explicitly),
`pnpm --filter @universum/web run build`, `CI=true pnpm --filter @universum/e2e run test`.
Playwright: projects `desktop-chromium` + `iphone-webkit` (devices["iPhone 15"]); own ports 2577/5183; CI runs
`vite preview` on the build, locally `vite` dev; `reuseExistingServer` off on CI.
Install browsers: `pnpm --filter @universum/e2e exec playwright install --with-deps chromium webkit`.

## Server config (apps/server/src/config.ts)

`loadConfig(env)` → `{ port (PORT, 2567), host (HOST, 127.0.0.1), dataDir (DATA_DIR, apps/server/data) }`.
Extend it for limits/Sentry/log level. `.env.example` at the root; `apps/server/data/` gitignored.

## Assets (apps/web/assets)

`logo.png` (v1 monopoly_logo.png — note v1 actually showed a text logo), `sounds/dice.mp3`, and 44 images under
`images/` keeping v1's relative paths below `game/` (e.g. `images/characters/haz_alap.png`,
`images/moreenemiesanimations/Alien sprites/alienPink.png`). Board textures are v1's `client/public` versions;
the two DOM-only variants that differ are `characters/museum_ui.png` and `characters/diploma_ui.png`.
Includes dice 1–6 + dice_detailed and the 8 random game backdrops (v1 uses them; the Tabletop design may not).
