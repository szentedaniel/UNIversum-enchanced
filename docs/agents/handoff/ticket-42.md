# Ticket #42 (Docker compose packaging) — facts for later tickets

Branch `ticket/42-docker`. Files: root `Dockerfile`, `compose.yaml`, `Caddyfile`, `.dockerignore`; CI job `docker`
(push to main only, `docker compose build`); README "Running with Docker"; `.env.example` `HTTP_PORT`.

## Layout

- Dockerfile stages: `pnpm` (node:26-slim + pnpm from `packageManager`, `COPY . .`), `server-build`
  (`pnpm install --frozen-lockfile --prod --filter "@universum/server..."`, BuildKit cache mount for the store),
  `server` (copies root package.json + node_modules + packages/ + apps/server; `USER node`; WORKDIR apps/server;
  `CMD ["node","src/main.ts"]`; env HOST=0.0.0.0 PORT=2567 DATA_DIR=/data), `web-build` (filtered install of
  `@universum/web...`, postinstall compiles Paraglide — the inlang plugin loads from node_modules, so no CDN fetch;
  `vite build` then deletes `*.map`), `web` (`caddy:2.11-alpine`, dist in `/srv`).
- **New server runtime deps** are picked up automatically (prod filtered install). A new workspace package the
  server depends on works too (all of `packages/` is copied). Anything outside `apps/server` + `packages/` is not in
  the image — e.g. a migrations folder must live under one of those.
- `.dockerignore` excludes node_modules, dist, `apps/web/src/paraglide`, `apps/server/data`, `.env*` (not
  `.env.example`), `.git`, `.github`, `v1`, `docs`, `.claude`, `.agents`.
- Server image ≈ 410 MB, of which deps are 30 MB (rest is node:26-slim). Web ≈ 90 MB.

## compose.yaml

- `name: universum`; volume `data` → `/data` (SQLite, #34 uses DATA_DIR). `env_file: .env` (optional) feeds the
  server; `environment` pins HOST/PORT/DATA_DIR over it (dev .env says HOST=127.0.0.1).
- **Healthcheck** is `node -e fetch('http://127.0.0.1:2567/__healthcheck')` (no curl/wget in slim). **#43: switch it
  to `/readyz` on the internal metrics port** (keep the port unpublished; Caddy must never route it).
  `web` waits on `server: service_healthy`.
- Logging anchor `x-logging` (local driver, 20m × 5) on both services — reuse it for the #43 `monitoring` profile
  services. #46's load-test override can extend `server` (cpus/mem_limit/env).
- Host port `${HTTP_PORT:-80}`. For parallel local testing use `HTTP_PORT=8042 docker compose -p <name> up`.

## Caddyfile

- `:80`; `handle_path /colyseus/*` → `reverse_proxy server:2567` with `header_up X-Real-IP {remote_host}` and
  `header_up -X-Client-IP` (verified: a spoofed X-Real-IP is replaced; X-Client-IP dropped). Behind Docker Desktop
  the remote IP is the VM gateway (192.168.65.1), on Linux the real client — #37's per-IP limits read `x-real-ip`.
- `*.map` → 404 in its own `handle` **before** the SPA handle (inside the same handle, `try_files` rewrites first
  and the map request gets index.html). New server HTTP routes the browser needs (#44 `/client-config`,
  `/errors`) need their own `handle` + `reverse_proxy server:2567` (same header_up lines), else they fall through
  to the SPA shell (200 index.html).
- `/assets/*` immutable cache; everything else `no-cache`. Format check: `caddy fmt` (tabs).

## Verified locally (Docker Desktop 29.8, Compose 5.5)

`docker compose build`; `up --wait` → both healthy; `/`, `/room/X` → shell; `/colyseus/__healthcheck` → OK; two
`@colyseus/sdk` clients via `http://localhost:8042/colyseus` create/join/Start/Roll; headless Chromium Create Room →
Lobby, no console errors; `/data` writable by `node`.
