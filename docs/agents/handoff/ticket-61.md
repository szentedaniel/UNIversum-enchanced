# Ticket #61 (a browser join constructs one WebSocket) — what changed and gotchas

Branch `ticket/61-websocket-protocol-throw` (on `v2-modernization`), spec #22.

## Did the throw reach `window` or Sentry in WebKit? No

How it was checked: a throwaway spec on `iphone-webkit` and `desktop-chromium`
(deleted before the commit) installed an init script before the app's scripts
that wrapped `window.WebSocket` and recorded every construction with `typeof`
of the protocols argument, and added `window` `error` / `unhandledrejection`
listeners; the spec also routed `**/client-config` to `{ errorReporting: true }`
and `**/errors` as `error-reporting.spec.ts` does, and threw one control error
from a `setTimeout` to prove the reporter was live.

On the unpatched SDK, both projects: the join constructed the Node form
(`protocols: "object"`), which threw, then the browser form (`protocols:
"undefined"`), which connected. The page's `error`/`unhandledrejection`
listeners recorded nothing, and `/errors` received only the control error.
WebKit is the only side that surfaced the caught throw, as a Playwright
`pageerror`; Chromium reported nothing.

So it is a Playwright WebKit artefact: no `window.onerror`, no Sentry envelope,
no false report from real Safari/iOS. The attempt still cost a second WebSocket
construction per join, so it was fixed anyway.

## The fix: a pnpm patch, not a transport override

- `patches/@colyseus__sdk@0.18.5.patch`, wired through `patchedDependencies`
  in `pnpm-workspace.yaml` and `pnpm-lock.yaml`.
- `WebSocketTransport.connect()` picks the browser form
  (`new WebSocket(url, protocols)`) when `typeof document !== "undefined"` and
  keeps the Node options object plus the fallback otherwise. Node 26's global
  `WebSocket` (undici) takes the options object, so `apps/server/test` and
  `apps/loadtest` are unchanged.
- Patched `build/*.mjs`, `build/*.cjs` and `src/transport/WebSocketTransport.ts`
  (the `@source` condition). The `.map` files are left as published.
- Why not a client-side transport override: `Connection` constructs its own
  transport (`build/Connection.mjs:35`) and `Client` exposes no transport hook,
  so an override means replacing the global `WebSocket` or reaching into a
  private field — a larger blast radius than a twenty-line patch visible in
  review.
- Upgrades: 0.18.5 is the latest. A bump makes pnpm fail to apply the patch
  loudly until it is refreshed; if a release fixes `connect()`, delete the patch
  file and the `patchedDependencies` entry together.
- Docker: the build stage's `COPY . .` carries `patches/`, and
  `pnpm install --frozen-lockfile` applies it.

## The e2e guard

- `apps/e2e/tests/helpers.ts`: `registerPage` attaches `page.on("pageerror")` to
  each page (once per page), and the auto `failureDump` fixture fails a test
  that passed while its pages threw — attaching the dumps first, as for any
  failure. A spec that throws on purpose must stay off the shared `test`:
  `error-reporting.spec.ts` imports `@playwright/test` directly and is safe.
- `createAndJoin` installs a socket probe (`class Probe extends WebSocket`)
  before the page's scripts; `startGame` asserts each page constructed exactly
  one WebSocket, with `protocols: "undefined"` — the browser form. A second
  construction, or the `"object"` form, fails setup with the page's name.
- The probe writes `window.universumWebSockets` (`SocketCall[]`, declared in
  `apps/e2e/tests/test-hooks.ts`).
- `field-card.spec.ts` now imports the shared fixture and `startGame` (it kept
  a local copy), so it gets both the guard and the failure dump.

## Gotchas

- The probe runs only through `createAndJoin`/`startGame`. Specs that build
  their own flow (`two-guests`, `full-game`) get the pageerror guard but not the
  socket count; register their pages before navigating if a load-time pageerror
  must be caught.
- `SocketCall.protocols` is `typeof` of the constructor's second argument:
  `"undefined"` for the one-argument call and for `undefined` protocols,
  `"object"` for the Node form, `"string"` if a real subprotocol is ever set.
- `error.name` is empty for WebKit's DOMException; the guard reports
  `page threw: <stack>`, so the message stays readable.
- The pageerror check runs only when the test itself passed; a failing test
  keeps its own error and still gets its dumps.
