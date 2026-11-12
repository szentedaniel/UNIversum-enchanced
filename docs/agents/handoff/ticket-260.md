# Ticket #260 (network-first service worker) — facts for later tickets

Branch `agent/issue-260-pwa-network-first-service-worker-with-tested-routi`. Files: `apps/web/src/pwa/routing.ts`,
`apps/web/src/pwa/sw.ts`, `apps/web/src/pwa/register.ts`, `apps/web/src/main.tsx`, `apps/web/vite.config.ts`,
`apps/web/tsconfig.app.json`, `apps/web/tsconfig.worker.json`, `Caddyfile`, `apps/web/test/sw-routing.test.ts`,
`apps/web/test/sw-register.test.ts`. Spec #184's update-prompt ticket (#261) builds on this surface.

## Routing

- `routing.ts` exports `routeOf(request: { url; method; mode }, origin)` returning `"never" | "network-first" |
  "cache-first-hashed"`. The order is: cross-origin → never, non-GET → never, `/colyseus` and its descendants
  (the WebSocket upgrade included), `/client-config`, `/errors` → never, `/assets/` → `cache-first-hashed`,
  `mode === "navigate"` → `network-first`, everything else → never. A "never" request gets no
  `respondWith`, so the browser handles it normally.
- The server paths match exactly and their subpaths; `/colyseus-lobby` and `/errors-page` are ordinary
  navigations. Non-navigation GETs of `/index.html`, the manifest, icons and `/sw.js` are never touched.
- `apps/web/test/sw-routing.test.ts` pins the routes with fixed URLs and no timers. It also scans `sw.ts`
  (comments stripped) for `skipWaiting`/`clients.claim`.

## The worker and its cache

- `sw.ts` is the thin shell: `install` opens the release's cache, `activate` deletes every other
  `universum-*` cache, `fetch` asks `routeOf` and calls `cacheFirst` or `networkFirst`.
- One cache per release: `universum-${CLIENT_RELEASE}`. Vite's `define` supplies `CLIENT_RELEASE` to the
  worker entry too, so a deploy with a new `RELEASE` starts with an empty cache and drops the old one.
- `cacheFirst` answers `/assets/*` from the cache (`ignoreSearch: true`) and fills it from the network.
  `networkFirst` returns the network response and stores successful shells under `/index.html`; a network
  failure falls back to that key. Neither route caches a non-`ok` response, and no cache write rejects the
  fetch (`waitUntil(...catch(() => undefined))`).
- There is no `skipWaiting` and no `clients.claim`: a new worker waits, so it takes over on the next launch.
  A test guards the two calls by scanning the source without comments.

## Build, registration and Caddy

- `apps/web/vite.config.ts` adds `src/pwa/sw.ts` as a second Rollup input; `entryFileNames` pins its output to
  `sw.js` (the app chunks keep `assets/[name]-[hash].js`). `TEST_HOOKS=1 pnpm --filter @universum/web run build`
  writes `dist/sw.js`; the worker is registered as a module (`{ scope: "/", type: "module" }`).
- `apps/web/tsconfig.worker.json` type-checks `sw.ts` with the `webworker` lib; `tsconfig.app.json` excludes
  `src/pwa/sw.ts` so the lib never reaches the app, and the web `typecheck` script runs the third project.
- `registerServiceWorker()` runs only when `import.meta.env.PROD`, the browser has a service worker and
  `window.isSecureContext` is true (localhost is a secure context; plain `http:` elsewhere is not). It waits
  for `load`. `apps/web/src/main.tsx` calls it once after error reporting and audio setup.
- `Caddyfile` has a `handle /sw.js` before the SPA fallback: `Content-Type: text/javascript; charset=utf-8`,
  `Cache-Control: no-cache`, `Service-Worker-Allowed: /`. The shell's `@shell` matcher also excludes `/sw.js`.
  The service worker scope is the root because the script is served from `/sw.js`.
- `apps/web/test/sw-register.test.ts` stubs `PROD`, `navigator.serviceWorker` and `window`; it pins the dev
  no-op, the post-`load` registration, the secure-context guard and the no-API guard.

## For #261 (refresh prompt)

- The worker never messages a client and never reloads; `CLIENT_RELEASE` is only used for the cache name.
  An update prompt needs its own signal (a `message`/`BroadcastChannel` from the worker or a server release
  comparison) and its own Paraglide messages.
- A waiting worker only activates after every tab of the old worker closes, so a prompt must offer an explicit
  reload only when the game is not in progress (spec #184, Decision 3).
