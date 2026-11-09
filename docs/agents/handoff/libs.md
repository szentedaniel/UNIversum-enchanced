# Library facts & gotchas (checked 2026-10-19 against the npm registry + package sources)

Facts marked **(src)** were read from the published package source (via `npm pack` during exploration). The installed packages under `node_modules/` are now the place to grep.

## Latest versions (npm `latest` tag, 2026-10-19)

| Package                                              | Version                                                                                    | Note                                                                                                                                               |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| node                                                 | **26.12.0** (2026-10-14; local dev box has 26.11.1). Not LTS yet (LTS 2026-10-28 per spec) |                                                                                                                                                    |
| pnpm                                                 | **12.14.0**                                                                                |                                                                                                                                                    |
| typescript                                           | **7.0.2** (native Go compiler, bin `tsc`)                                                  | `@typescript/typescript6` 6.0.2 = TS6 JS API (bin `tsc6`); `@typescript/native-preview` 7.0.0-dev.20260707.2 is the old preview — **don't use it** |
| oxlint / oxlint-tsgolint / oxfmt                     | **1.88.0** / **7.0.2004** / **0.73.0**                                                     | oxlint peer: `oxlint-tsgolint >=7.0.2003`                                                                                                          |
| vite                                                 | **8.3.4** (rolldown ~1.2.12, lightningcss)                                                 |                                                                                                                                                    |
| @vitejs/plugin-react                                 | 6.1.2                                                                                      |                                                                                                                                                    |
| vitest                                               | **5.0.5**                                                                                  | `@fast-check/vitest` 0.5.0                                                                                                                         |
| react / react-dom                                    | **19.3.1** (`@types/react` 19.3.0)                                                         |                                                                                                                                                    |
| react-router                                         | **8.4.0**                                                                                  | `react-router-dom` is dead (last 7.18.4)                                                                                                           |
| @inlang/paraglide-js                                 | **2.29.0**                                                                                 | `@inlang/plugin-message-format` 4.5.4                                                                                                              |
| pixi.js                                              | **8.22.0**                                                                                 | `@assetpack/core` 1.7.0 (`@pixi/assetpack` does not exist)                                                                                         |
| zustand                                              | **5.0.15**                                                                                 |                                                                                                                                                    |
| tailwindcss / @tailwindcss/vite                      | **4.3.3**                                                                                  |                                                                                                                                                    |
| shadcn (CLI)                                         | **4.22.1**                                                                                 | Base UI pkg: **`@base-ui/react` 1.9.0** (old name `@base-ui-components/react` stuck at 1.0.0-rc.0)                                                 |
| lucide-react                                         | 1.59.0                                                                                     |                                                                                                                                                    |
| @fontsource/sigmar-one / @fontsource-variable/nunito | 5.3.0 / 5.3.0                                                                              |                                                                                                                                                    |
| colyseus (meta)                                      | 0.18.9                                                                                     | **don't install** — pulls @colyseus/monitor, playground, redis-*, auth                                                                             |
| @colyseus/core                                       | **0.18.19**                                                                                | peer (non-optional): `@colyseus/schema ^5.0.8` (latest 5.0.41)                                                                                     |
| @colyseus/ws-transport                               | 0.18.4                                                                                     |                                                                                                                                                    |
| @colyseus/sdk                                        | **0.18.5**                                                                                 | `colyseus.js` is the old 0.16 client — don't use                                                                                                   |
| @colyseus/testing                                    | 0.18.6                                                                                     | peers: core, sdk, **@colyseus/tools** (0.18.10)                                                                                                    |
| @colyseus/loadtest                                   | 0.18.3                                                                                     | depends on `typescript ^6.0.3`, `blessed` (TUI)                                                                                                    |
| pure-rand                                            | **8.4.2**                                                                                  |                                                                                                                                                    |
| fast-check                                           | **4.10.2**                                                                                 |                                                                                                                                                    |
| @playwright/test                                     | **1.64.1** (Chromium 156, WebKit 27.2, Firefox 157)                                        |                                                                                                                                                    |
| pino / pino-pretty                                   | **10.4.0** / 13.2.0                                                                        | v10's only breaking change: drops Node 18                                                                                                          |
| @prometheus-io/client                                | **0.16.1** (formerly `prom-client`, last 15.1.3)                                           | CJS, engines `^22 \|\| ^24 \|\| >=26`                                                                                                              |
| rate-limiter-flexible                                | **11.2.3**                                                                                 |                                                                                                                                                    |
| zod                                                  | 4.6.7                                                                                      |                                                                                                                                                    |
| @sentry/node / @sentry/react / @sentry/vite-plugin   | 11.8.0                                                                                     |                                                                                                                                                    |
| @types/node                                          | 26.6.5                                                                                     |                                                                                                                                                    |
| msgpackr                                             | 2.1.1                                                                                      | (Colyseus wire format)                                                                                                                             |

Everything named in the spec exists at the named major. Substitutions: `react-router-dom` → `react-router` (+ `react-router/dom`); `@base-ui-components/react` → `@base-ui/react`; "tsgo/native-preview" → plain `typescript@7`; `prom-client` → `@prometheus-io/client`.

---

## Colyseus 0.18 — server (`@colyseus/core` 0.18.19) (src)

Install: `@colyseus/core @colyseus/ws-transport @colyseus/schema` (+ `@colyseus/tools` only if using `listen()`/testing). Node `>=22`. ESM; exports point `@source` condition at `./src/*.ts`.

```ts
import {
  Server,
  Room,
  matchMaker,
  LobbyRoom,
  defineServer,
  defineRoom,
  ServerError,
  CloseCode,
  ErrorCode,
} from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";

const server = defineServer({
  rooms: { game: defineRoom(GameRoom), lobby: defineRoom(LobbyRoom) }, // or server.define('game', GameRoom).enableRealtimeListing()
  transport: new WebSocketTransport({
    maxPayload: 1024,
    beforeUpgrade: async (req, ctx) => {
      /* ctx.ip; return new Response(null,{status:429}) to refuse */
    },
  }),
  greet: false,
  logger: pinoLogger,
  gracefullyShutdown: true, // registers SIGINT/SIGTERM
});
await server.listen(port);
```

- Room realtime listing needs `.enableRealtimeListing()` on the handler (`server.define(...)` returns `RegisteredHandler`; with `defineRoom(...)` call `.enableRealtimeListing()` on the result).
- `WebSocketTransport` defaults: `maxPayload 4*1024`, `perMessageDeflate false`, `pingInterval 3000`, `pingMaxRetries 2`. `beforeUpgrade(request: Request, context: AuthContext)` runs before the WS handshake (good place for the per-IP open-socket cap).
- `ServerOptions.express?: (app) => void` mounts Express routes (needs `express` installed). For `/metrics`, `/healthz`, `/readyz` on the **internal port**, just run a separate `node:http` server.
- **IP resolution** (`createAuthContext`, used for both `onAuth` and `beforeUpgrade`): `x-real-ip` → `x-forwarded-for` (first hop) → `x-client-ip` → socket `remoteAddress`. So Caddy's `header_up X-Real-IP {remote_host}` wins; strip `X-Client-IP`. In dev (Vite proxy) headers are client-controlled: fine for dev only.

### Room lifecycle / fields

- Hooks: `onCreate(options)`, static `onAuth(token, options, context)`, `onJoin(client, options, auth)`, **`onDrop(client, code)`** (non-consented leave; call `allowReconnection` here), **`onReconnect(client)`**, `onLeave(client, code)` (consented leave, or after reconnection given up), `onDispose()`, `onBeforeShutdown()`, `onUncaughtException(err, methodName)`.
- **Without Schema state**: just never set `this.state`. Serializer stays `none`; clients get no `ROOM_STATE`; use `this.broadcast(type, payload)` / `client.send(type, payload)` (msgpack). `broadcastPatch()` still ticks `this.clock` every `patchRate` (default 50 ms) — keep it (clock timers need ticks) or set `patchRate = null` (then a 16 ms clock interval runs instead).
- **`roomId`**: setter only allowed while `CREATING` → set `this.roomId = code` inside `onCreate`. Duplicate ids: `handleCreateRoom` → `recordRoom` → LocalDriver `insert` fails → room silently discarded and **the existing room's listing is returned** (create() would then reserve a seat in the other Room!). Always check the code is free (store + `matchMaker.getLocalRoomById`) before using it.
- **`seatReservationTimeout` is in SECONDS** (default 15, env `COLYSEUS_SEAT_RESERVATION_TIME`). Spec 5 s → `seatReservationTimeout = 5`.
- **`autoDispose` (default true)**: a fresh/restored room with no clients disposes after `seatReservationTimeout` seconds, and any room disposes when the last client leaves. Restored Rooms and running games must set `this.autoDispose = false` and dispose explicitly (`this.disconnect()`) for retention.
- `maxClients`: room locks when `clients + reservedSeats >= maxClients`. **Seats held by `allowReconnection` count as reserved**, so a Guest-token rejoin from a new tab into a full 4-Seat game would be refused while the old seat is held. Either keep `maxClients` above the Seat count and enforce Seats yourself, or `reject()` the pending reconnection Deferred before the new join.
- `maxMessagesPerSecond` (default `Infinity`): exceeding it **closes the socket** (`CloseCode.WITH_ERROR`). Use it only as the hard ">50 in one second" cutoff; implement the 10/s soft limit + `SLOW_DOWN` yourself.
- Class fields under Node type-stripping (native class fields) shadow Room's prototype accessors (`maxClients`, `autoDispose`, `patchRate`, `state`); core re-installs them in `__init()` at a perf cost. Prefer assigning them in `onCreate`.
- `setMetadata(meta)` replaces (not merges) metadata. `setMatchmaking({ metadata, locked, maxClients, private, unlisted })`.
- **Unlisting a started game**: `setMatchmaking({ unlisted: true })` does **NOT** notify LobbyRoom clients (`updateLobby` returns early for unlisted rooms → no `'-'`). `setPrivate(true)` does send `'-'` (visibility-change). Spec says not to use `private` for passwords; using it only for "game started" is OK, or subclass `LobbyRoom` and override `filterItemForClient` (e.g. require `metadata.phase === 'lobby'` — a changed listing then sends `'-'`).
- Never put secrets in metadata: LobbyRoom sends the whole `IRoomCache` (`name, roomId, processId, clients, maxClients, locked, private, metadata, createdAt, publicAddress`).

### `allowReconnection(client, seconds | "manual")` (src)

- `"manual"` = `Infinity` (never expires). Returns a `Deferred<Client>`; resolve happens when the same `reconnectionToken` reconnects; **you must call `.reject()` yourself** (e.g. game end, Guest-token rejoin) or the seat stays reserved forever.
- Rejects immediately if the client never fully joined, or room is disposing.
- `onLeave` is still called (after `onDrop`) once the reconnection is rejected.
- On server shutdown, `onBeforeShutdown` → `disconnect(CloseCode.SERVER_SHUTDOWN=4001)` → onLeave/onDispose run: **don't free Seats / delete the stored Room in onLeave/onDispose during shutdown.**

### Static `onAuth` (src)

- `static async onAuth(token, options, context: { token?, ip, headers: Headers, req? })`. Return `false/null/undefined` → `AUTH_FAILED`; `true` → ok; object → becomes `client.auth`.
- Called by matchmaker **before** seat reservation in `create`, `join`, `joinOrCreate`, `joinById` (only when there's an HTTP auth context). Instance-level `onAuth` is ignored when static exists.
- It receives **no room instance / roomId**. For password Rooms the client must also send the code in options; look up the hash from your registry/store, and re-check in `onJoin` that `options.code === this.roomId`.
- `joinById` throws `MATCHMAKE_INVALID_ROOM_ID (522)` if room not found **or locked** — before onAuth.
- Errors: throw `new ServerError(code, message)`. HTTP matchmake response = status `e.code`, body `{ code, error: message }`; SDK throws `MatchMakeError(message, code)`. Only `code` + `message` reach the client → encode `{code:'PASSWORD_LOCKED', retryAfter}` as JSON in `message`, and use a valid HTTP status number for `code` (e.g. 403/429; built-in ErrorCodes are 520–526).
- No built-in body-size limit on `/matchmake/*` (better-call router). The 2 KB cap needs a wrapper around the HTTP server's `request` handler.

### Messages (src)

- `onMessage(type, handler)`; `onMessage('*', (client, type, msg) => …)` catches unknown types. **Without a handler for a type, production closes the socket** (`client.leave(WITH_ERROR)`), dev sends `INVALID_PAYLOAD` → register `'*'`.
- Built-in validation (`messages = { x: validate(zodSchema, handler) }` or `onMessage(type, schema, handler)`): an invalid payload **closes the connection**. Spec wants `MALFORMED` + keep socket → don't use it; `safeParse` inside a plain handler.
- msgpack decode failure also closes the connection (unavoidable).
- `client.send` in `onJoin` is queued until the client acks the join → safe.

### Matchmaker API (src)

`matchMaker.createRoom(name, options) → IRoomCache` (server-side create, no auth — use for boot restore), `getLocalRoomById(id)`, `query({...})`, `joinById/create/join/reconnect`, `gracefullyShutdown()`, `onReady` (Deferred).
Built-in `devMode` / `onCacheRoom`/`onRestoreRoom` restore exists but is dev-only and uses presence — not for production restore.

### LobbyRoom (src)

`import { LobbyRoom } from '@colyseus/core'`; define as `lobby`. Client gets `'rooms'` (IRoomCache[]) on join, then `'+'` `[roomId, room]` (add/update) and `'-'` `roomId`. Client may send `'filter'` `{ name?, metadata? }`. Initial list = `matchMaker.query({ private: false, unlisted: false })`.

### `colyseus/vite`

The meta package has a `colyseus/vite` plugin that shares Vite's dev server. Spec chose a Vite proxy instead; ignore.

## Colyseus SDK 0.18 (`@colyseus/sdk` 0.18.5) (src)

```ts
import { Client, MatchMakeError, CloseCode } from '@colyseus/sdk'   // Client = ColyseusSDK
const sdk = new Client('/')            // or `${location.origin}` / ws url; HTTP matchmake POST /matchmake/:method/:room
const room = await sdk.joinById(code, { guestToken, code, password })   // create(), join(), joinOrCreate(), reconnect(token)
room.onMessage('view', (v) => …); room.send('intent', payload)
room.onDrop((code, reason) => …); room.onReconnect(() => …); room.onLeave((code, reason) => …); room.onError((code, msg) => …)
room.reconnectionToken   // "roomId:token"; sdk.reconnect(room.reconnectionToken)
```

- **Built-in auto-reconnect** (`room.reconnection`): `enabled true, maxRetries 15, minDelay 100, maxDelay 5000, minUptime 5000` ms (a room joined < 5 s ago is **not** auto-reconnected → `onLeave(ABNORMAL_CLOSURE)`), exponential backoff (override `backoff(attempt, delay)` to add jitter). Fires `onDrop` then `onReconnect`, or `onLeave(FAILED_TO_RECONNECT=4003)` when exhausted → then fall back to Guest-token `joinById`.
- Messages sent while disconnected are **buffered (max 10) and replayed** after reconnect. Intents carry `turn` so stale ones get rejected, but consider `room.reconnection.maxEnqueuedMessages = 0`.
- Unregistered message type → `console.warn`, dropped.
- Close codes: `CONSENTED 4000, SERVER_SHUTDOWN 4001, WITH_ERROR 4002, FAILED_TO_RECONNECT 4003, MAY_TRY_RECONNECT 4010`.

## @colyseus/testing 0.18.6 (src)

```ts
import { boot, ColyseusTestServer } from "@colyseus/testing";
const colyseus = await boot(server /* a Server instance */); // listens on 2568
const room = await colyseus.createRoom("game", opts); // matchMaker.createRoom → local Room instance
const c1 = await colyseus.connectTo(room, { guestToken }); // sdk.joinById; waitForInitialState resolves at once with no state
await c1.waitForMessage("view"); // client-side helper (3 s timeout)
await room.waitForMessage("intent"); // server-side helper
await colyseus.cleanup();
await colyseus.shutdown();
```

- **`boot(serverInstance, port)` ignores `port`** and always listens on 2568; `boot(config, port)` respects it. Vitest runs files in parallel → port clash. Use a single fork / `fileParallelism: false` for the server package, or build `new ColyseusTestServer(server)` yourself after `server.listen(0)`.
- `matchMaker` is a module singleton: one Server per process at a time. For "restart on the same SQLite file", `await colyseus.shutdown()` (`gracefullyShutdown(false)`) then boot a new Server. Watch for shutdown calling your onLeave/onDispose.
- Importing `@colyseus/tools` loads `.env` via dotenv as a side effect.

## @colyseus/loadtest 0.18.3

Script style: `import { cli, type Options } from '@colyseus/loadtest'; cli(async (options) => { const client = new Client(options.endpoint); … })`, run `node script.ts --endpoint ws://… --room game --numClients 100 [--delay ms] [--output file]`. Uses `blessed` TUI (spec allows replacing it with SDK + `worker_threads`).

---

## pnpm 12 workspace

- `pnpm-workspace.yaml`: `packages: [...]`, `catalog:` (default) / `catalogs: { name: {...} }`; reference with `"dep": "catalog:"` / `"catalog:name"` in deps/devDeps/peerDeps/optionalDeps and `overrides`. `catalogMode: strict|prefer|manual` (default manual); `catalogPrune` (11.22+).
- **Only auth/registry settings are read from `.npmrc`**; everything else goes in `pnpm-workspace.yaml`.
- Build scripts: `strictDepBuilds` default **true** → install **fails** on unreviewed dependency build scripts. Approve per package: `allowBuilds: { esbuild: true, some-pkg: false }` (names, ranges, `@scope/*`). `dangerouslyAllowAllBuilds: false`. (Likely candidates: none of the core stack needs postinstall; check after first install.)
- Pin Node: `engines.node` (not `engineStrict`: it breaks Dependabot, whose Node is older), and/or `"packageManager": "pnpm@12.14.0"` + `.node-version`/`.nvmrc` 26.

## TypeScript 7.0 (Go native) — `typescript@7.0.2`, bin `tsc`

- Installs per-platform native binaries (`@typescript/typescript-<os>-<arch>` deps).
- **No JS API in 7.0** (planned for 7.1). Tools needing the TS API use `@typescript/typescript6` (bin `tsc6`). Paraglide's `emitTsDeclarations` detects TS 7 and falls back to running the `tsc` CLI (src).
- Hard errors: `target es5`, `downlevelIteration`, `moduleResolution node/node10/classic`, `module amd/umd/system/none`, **`baseUrl`**, `esModuleInterop:false`, `allowSyntheticDefaultImports:false`, `alwaysStrict:false`.
- New defaults: `strict: true`, `module: esnext`, target = latest stable ES, `noUncheckedSideEffectImports: true`, **`types: []`** (add `"types": ["node"]` / `["vite/client"]` explicitly), `rootDir: ./`, `stableTypeOrdering: true`.
- House style options exist: `erasableSyntaxOnly`, `verbatimModuleSyntax`, `allowImportingTsExtensions` (+ `noEmit`), `rewriteRelativeImportExtensions`. Use `module/moduleResolution: nodenext` for Node packages (type stripping), `bundler` for web.

## Node 26: type stripping + `node:sqlite` (verified locally on 26.11.1)

- `node main.ts` runs TS with no flag (`process.features.typescript === 'strip'`). `enum`/namespaces/parameter properties → `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`. Relative imports must carry `.ts`. `import type` / inline `type` specifiers required for type-only imports (verbatimModuleSyntax).
- A workspace package symlinked into `node_modules` exporting `./src/index.ts` **works** (Node resolves the realpath outside node_modules; tested with `exports` + `#*` `imports`). Node refuses to strip `.ts` that really lives inside `node_modules` (so packages must stay workspace links, not copied — matters for the Docker `pnpm deploy`/filtered install: keep workspace packages as source dirs).
- `node --watch main.ts` for dev.
- `node:sqlite` loads with no flag/warning; exports `DatabaseSync, Database (async), StatementSync, Statement, Session, constants, backup`. `DatabaseSync` methods: `open, close, prepare, exec, function, createTagStore, aggregate, createSession, applyChangeset, serialize, deserialize, setAuthorizer, createModule, enableDefensive, loadExtension`. **No `transaction()` helper** → `db.exec('BEGIN IMMEDIATE')`… `COMMIT`/`ROLLBACK` manually. Rows come back as null-prototype objects. Setup: `db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=5000")`.

## Oxlint + Oxfmt

- `oxlint --type-aware` (needs devDep `oxlint-tsgolint`), `oxlint --type-aware --type-check` (adds typescript-go type diagnostics). Config `.oxlintrc.json` (`$schema: ./node_modules/oxlint/configuration_schema.json`) or `oxlint.config.ts` with `defineConfig` from `oxlint`. Top-level keys: `plugins, categories, rules, overrides, ignorePatterns, settings, env, globals, extends, jsPlugins, options`. `options: { typeAware, typeCheck, denyWarnings, maxWarnings, reportUnusedDisableDirectives }`.
- Plugins enum: `eslint, react, unicorn, typescript, oxc, import, jsdoc, jest, vitest, jsx-a11y, nextjs, react-perf, promise, node, vue`. `no-restricted-imports` is supported (use in an `overrides` entry for `packages/web/**` with `paths`/`patterns` to ban `@universum/rules` (except `/board` and types), `@universum/protocol` (except the Zod-free subpath) and `zod`). Use `allowTypeImports` if needed.
- Oxfmt: `oxfmt` writes, `oxfmt --check` for CI; `oxfmt --init`, `oxfmt --migrate` (from Prettier/Biome). Config keys (`.oxfmtrc.json`): `printWidth, tabWidth, useTabs, semi, singleQuote, jsxSingleQuote, quoteProps, trailingComma, arrowParens, bracketSpacing, bracketSameLine, endOfLine, objectWrap, sortImports, sortPackageJson, sortTailwindcss, ignorePatterns, overrides, insertFinalNewline, …`. Aims for Prettier-identical output.

## Vite 8.3

- Rolldown-based. `build.rollupOptions` → **`build.rolldownOptions`** (old name deprecated but accepted). Default `build.target: 'baseline-widely-available'` = `['chrome111','edge111','firefox114','safari16.4','ios16.4']` (src) — matches spec.
- Dev proxy for Colyseus (HTTP matchmake + WS): `server: { host: true /* --host */, proxy: { '/matchmake': 'http://localhost:2567', '/<ws path>': { target: 'ws://localhost:2567', ws: true } } }`. (src) SDK builds HTTP `…{pathname}/matchmake/{method}/{room}` and WS `…{pathname}/{processId}/{roomId}?sessionId=…&reconnectionToken=…` from one base URL; `new Client('/colyseus')` resolves against the page origin (`ws(s)://host:port/colyseus`; default with no arg = page origin root). So put the whole Colyseus endpoint under one prefix and proxy it: Vite `proxy: { '/colyseus': { target: 'http://localhost:2567', ws: true, rewrite: (p) => p.replace(/^\/colyseus/, '') } }`, Caddy `handle_path /colyseus/* { reverse_proxy server:2567 { header_up X-Real-IP {remote_host}; header_up -X-Client-IP } }`. Note: query params of the WS URL appear in proxy access logs (reconnectionToken!) — keep Caddy access logs off or redacted.
- `server.allowedHosts` (string[] | true) matters for LAN phone testing with a hostname.
- `build.sourcemap: 'hidden'`.

## React Router 8.4 (declarative mode)

- ESM-only, React `>=19.2.7`, Node `>=22.22`. `react-router-dom` removed: import everything from `react-router`; only `RouterProvider`/`HydratedRouter` from `react-router/dom`.

```tsx
import { BrowserRouter, Routes, Route, useNavigate, useParams, Link } from 'react-router'
<BrowserRouter><Routes><Route path="/" element={<Home/>}/><Route path="/rooms" …/><Route path="/create" …/><Route path="/room/:code" …/><Route path="/game/:code" …/></Routes></BrowserRouter>
```

## Paraglide JS 2.29 (Vite plugin)

```ts
// vite.config.ts
import { paraglideVitePlugin } from "@inlang/paraglide-js";
paraglideVitePlugin({
  project: "./project.inlang",
  outdir: "./src/paraglide",
  strategy: ["localStorage", "preferredLanguage", "baseLocale"],
  localStorageKey: "PARAGLIDE_LOCALE" /* default */,
});
```

- Built-in strategies: `cookie | baseLocale | globalVariable | url | preferredLanguage | localStorage | custom-<name>`; default is `['cookie','globalVariable','baseLocale']` → must override for the spec.
- `project.inlang/settings.json`: `{ "baseLocale": "en", "locales": ["en","hu","de"], "modules": ["https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4/dist/index.js"], "plugin.inlang.messageFormat": { "pathPattern": "./messages/{locale}.json" } }`. **Plugin modules are fetched from jsDelivr at compile time** (CI + Docker build need network, or rely on inlang's module cache — check what `init` generates).
- Scaffold non-interactively: `pnpm dlx @inlang/paraglide-js init --yes --outdir ./src/paraglide --lint oxlint`.
- Use: `import { m } from './paraglide/messages.js'; import { getLocale, setLocale, locales } from './paraglide/runtime.js'`. `setLocale(l)` persists via strategies and **reloads the page by default** (spec wants reload). Messages: `{"greeting": "Hello {name}!"}` → `m.greeting({ name })`. Gitignore `src/paraglide/`. Dynamic keys (Field names, Rejection codes): build a typed map `Record<FieldId, () => string>` of `m.*` functions (keeps tree-shaking + type safety).

## PixiJS 8.22 (use the `pixijs` skills in this session for details)

- `const app = new Application(); await app.init({ autoStart: false, backgroundAlpha: 0, autoDensity: true, resolution, antialias, preference: 'webgl' })`; `app.canvas`; manual `app.render()` for redraw-on-demand; `app.destroy({ removeView: true }, { children: true })`.
- Container tint is inherited in v8 (used for greying). `new Text({ text, style, anchor })`, `text.resolution = n` to re-rasterise. `Graphics().poly(pts).fill({…}).stroke({…})`.
- Atlas: `@assetpack/core` 1.7.0 (`@assetpack/core/texture-packer` `texturePacker({ resolutionOptions: { resolutions: { default: 1, low: 0.5 }, template: '@%%x' } })`, `@assetpack/core/pixi` `pixiPipes(config)`). A folder tagged `{tps}` becomes one spritesheet. Generate pre-coloured frames (Group colours, owner houses) into the source folder in a build step before AssetPack.

## Zustand 5 vanilla stores

```ts
import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { subscribeWithSelector } from 'zustand/middleware'
export const roomStore = createStore<RoomState>()(subscribeWithSelector((set, get) => ({ … })))
roomStore.subscribe((s) => s.view, (view, prev) => board.setView(view))   // outside React (needs subscribeWithSelector)
const view = useStore(roomStore, (s) => s.view)                           // in React; object selectors → wrap in useShallow
```

v5: selectors returning new objects/arrays cause infinite re-render → `useShallow`.

## Tailwind v4 + shadcn/ui on Base UI

- Vite plugin `@tailwindcss/vite`; CSS-first config: `@import 'tailwindcss'; @custom-variant dark (...); @theme inline { --color-background: var(--background); … }` (see `notes/prototypes.md` / `ui.css`).
- shadcn CLI 4.22: `pnpm dlx shadcn@latest init -t vite -b base` (`-b, --base <base>`: `base | radix | aria`; **`-d` forces `--template=next --preset=base-nova`, so don't use `-d` for Vite**). Add components: `pnpm dlx shadcn@latest add button dialog … -b base`. Primitives come from `@base-ui/react`. Writes `components.json`; needs `@/*` path alias in tsconfig + Vite `resolve.alias` (TS 7: `paths` without `baseUrl`).

## pure-rand 8.4 (src)

- **Subpath imports only** (no root export):

```ts
import { xoroshiro128plus, xoroshiro128plusFromState } from "pure-rand/generator/xoroshiro128plus";
import { uniformInt } from "pure-rand/distribution/uniformInt";
const rng = xoroshiro128plusFromState(state.rng); // state.rng: number[4] (JSON-safe)
const d1 = uniformInt(rng, 1, 6); // MUTATES rng in place (v8)
const next = rng.getState(); // readonly number[4] → store back (copy with [...])
```

- `xoroshiro128plus(seed: number)` takes a 32-bit seed. For a fuller seed from `node:crypto`: `xoroshiro128plusFromState([...crypto.getRandomValues(new Int32Array(4))])` (avoid all-zero). Do the seeding in the server, pass the state into setup (rules stay pure).
- `RandomGenerator`: `clone(), next(), getState()`; jumpable: `jump()`. `purify()` in `pure-rand/utils/purify` if a pure API is wanted.

## fast-check 4.10

`fc.assert(fc.property(arbA, arbB, (a, b) => { … }), { seed, numRuns })`; `fc.integer({min,max})`, `fc.array`, `fc.constantFrom`, `fc.commands` for model-based. Vitest integration `@fast-check/vitest` 0.5.0 (`test.prop([fc.integer()])('…', (n) => …)`).

## Playwright 1.64

- Devices: `devices['Desktop Chrome']`, iPhone WebKit: **`devices['iPhone 17']`** (402×681 viewport, DPR 3, webkit, isMobile, hasTouch; Playwright's own default mobile WebKit device), also `iPhone 17 Pro`, `iPhone 17 Pro Max`, `iPhone 17e`, `iPhone Air`, `iPhone 16`, `iPhone 15`… and `… landscape` variants.
- Browsers: Chromium 156, WebKit 27.2. CI: `pnpm exec playwright install --with-deps chromium webkit`.
- Multi-Guest: one `browser.newContext({ ...devices['iPhone 17'] })` per Guest; `context.setOffline(true)` for reconnect tests.

## pino 10

`pino({ level, redact: { paths: [...], censor: '[redacted]' } })`; pretty in dev via `transport: { target: 'pino-pretty' }` (worker thread). Pass the logger to Colyseus `logger` option.

## @prometheus-io/client 0.16

```ts
import client from '@prometheus-io/client'       // CommonJS package
const register = new client.Registry(); client.collectDefaultMetrics({ register })
new client.Counter({ name: 'intents_total', help: '…', labelNames: ['result'], registers: [register] })
new client.Histogram({ name: 'intent_duration_seconds', help: '…', buckets: [...], registers: [register] })
res.setHeader('Content-Type', register.contentType); res.end(await register.metrics())
```

Default metric names used by the load-test verdict: `nodejs_eventloop_lag_p99_seconds`, `nodejs_eventloop_lag_seconds`, `process_cpu_seconds_total`, `process_resident_memory_bytes`, `nodejs_heap_size_used_bytes`, `nodejs_heap_size_total_bytes`. Point-in-time gauges: use `collect()` (non-arrow function).

## rate-limiter-flexible 11

```ts
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";
const perMin = new RateLimiterMemory({ keyPrefix: "create-min", points: 10, duration: 60 });
try {
  await perMin.consume(ipBucket);
} catch (e) {
  if (e instanceof Error) throw e;
  const retryAfter = Math.ceil((e as RateLimiterRes).msBeforeNext / 1000);
}
```

- `consume` **rejects with a `RateLimiterRes`** (not an Error) when over limit. Also `penalty, reward, get, set, block, delete`; options `blockDuration`, `execEvenly`. Exponential back-off for `PASSWORD_LOCKED`: track failures and call `block(key, secs)`.
- Concurrency caps (15 open Lobbies, 10 outstanding reservations, 100 sockets per IP) are counters, not rate limits: plain `Map<bucket, number>` with inc/dec on create/dispose, reserve/join-or-timeout, upgrade/close.

## Sentry 11

`@sentry/node` + `@sentry/react` 11.8.0. Spec: no tracing/replay/sessions → `Sentry.init({ dsn, release, sendDefaultPii: false, tracesSampleRate: undefined, … })`; browser `tunnel: '/errors'`. No `--import instrument` needed when no auto-instrumentation is wanted.
