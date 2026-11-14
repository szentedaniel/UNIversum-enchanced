# Ticket #265 (E2E: phone-viewport smoke test): facts for later tickets

Branch `agent/issue-265-e2e-phone-viewport-smoke-test-for-install-metadata`, parent spec #184 (mobile polish
and PWA), last ticket of its suggested order. Files: `apps/e2e/tests/mobile.spec.ts`,
`apps/e2e/tests/helpers.ts`, `apps/e2e/package.json` + `pnpm-lock.yaml` (`zod`, catalog version). No app code, no
`playwright.config.ts` change, no app test id added.

## The spec and the projects

- `mobile.spec.ts` has two describes: `phone portrait` (the install test and a layout test) and `phone
  landscape` (a layout test), so the file is three tests. It runs in both existing single-browser projects
  (`desktop-chromium`, `iphone-webkit`): the config's `testIgnore` only excludes `MIXED`, so the same phone
  profile runs on Chromium and WebKit.
- Each describe sets `test.use(PORTRAIT)` / `test.use(LANDSCAPE)`: the device descriptor's context options
  (`viewport`, `userAgent`, `deviceScaleFactor`, `isMobile`, `hasTouch`) plus `locale: "en-US"`. The descriptor's
  `defaultBrowserType` is **deliberately dropped** — `test.use` can override that worker option, and spreading the
  whole `devices["iPhone 15"]` would switch the desktop project to WebKit. `phoneOf` in the spec is the only
  place the profile is unpacked.
- Profiles: `devices["iPhone 15"]` is 393×659 CSS px, `devices["iPhone 15 landscape"]` 734×343 (Playwright's
  viewport is the screen minus browser chrome, so the landscape run is narrower than the 852×393 the earlier
  tickets measured). Both keep the phone layout: `WIDE_QUERY` needs 48rem wide and 36rem tall.
- The install test (`the install surface: …`) calls `test.skip(!CI, …)`: the manifest, the icons, `sw.js` and
  `version.json` are build output and CI previews the built app (`vite preview`); the layout tests run against the
  dev server too.
- `zod` parses the served JSON (`manifestSchema`, `versionSchema`) rather than a type assertion: oxlint's
  `typescript/no-unsafe-type-assertion` refuses `response.json() as T`.

## What the phone smoke checks

- Install: the `link[rel=manifest]` href is `/manifest.webmanifest`; its response is 200 with
  `application/manifest+json`; `display` is `standalone`; every listed icon is 200, `image/*`, and decodes (in
  the page, `new Image().decode()`) at its declared `sizes`; at least one icon's `purpose` is `maskable`. `sw.js`
  is served as JavaScript; `version.json` parses as a non-empty release. Whether the worker _controls_ the page
  is not asserted — `register.ts` registers only in a production build over a secure context.
- Layout: the two Player chips, the expanded `player-card` (above the Board) and the `pick-tray`; every button in
  the tray and in its checklist is ≥ 44 px (`TAP_TARGET_PX`); a Board drag pans the camera without zooming and
  `window.scrollY` stays 0.
- The portrait test adds `expectInsideViewport` for the whole tray after a pick: a portrait phone reserves 14rem
  for it (#264). A landscape phone's ceiling is ~154 px, so its tray scrolls; the shared journey therefore only
  requires the tray's top and sides on screen and its pinned primary action in the viewport
  (`toBeInViewport`).

## Shared steps added to `helpers.ts`

- `showPick(page, "doubler" | "erasmus")`: the made-up pick view through `showView`, with `PICK_FIELDS`
  (`budapest` 2, `berlin` 15, `london` 21, `museum4` 28), `actsAfter`/`turnDeadline` on the server clock.
  `pick-tray.spec.ts` still builds the same view inline; that spec was kept untouched by #265, so the duplication
  is deliberate and the local helper should import this step when that spec is next edited.
- `dragBoard(page, {dx, dy})`: a touch `PointerEvent` sequence (`pointerdown`/2 × `pointermove`/`pointerup`,
  `pointerType: "touch"`) on `[data-testid=board] canvas`, starting at the first point of a 20×20 grid where
  `document.elementFromPoint` is the canvas — i.e. the top band no card covers. It returns `{before, after}`
  cameras. Two gotchas: the gesture layer calls `setPointerCapture` on every touch down and a synthetic pointer
  is not active, so the helper stubs it on the canvas; and the camera is clamped at fit, so drag toward positive
  x/y (a negative drag can clamp to no movement — the helper asserts only that x changed, and the caller checks
  the scale is unchanged).

## Gotchas for later specs

- Tapping a checklist row on a short screen: the tray's primary action is `sticky bottom-0` in the card's scroll
  wrapper (#264), so it can cover a row's centre. The spec taps `{ position: { x: 12, y: 6 } }`; keep that, or
  assert the row's top area is still reachable.
- `expectTapTargets`/`expectInsideViewport` are local to `mobile.spec.ts` today. If a second spec needs them,
  move them into `helpers.ts` (one home for shared steps).
- A phone profile's `hasTouch` makes `Interactor.mobile` true; `press()` then uses `locator.tap()`, so a handler
  must be a real button click to work on the phone projects.

Read for: #184's phone smoke, any install-surface (manifest/worker/version) e2e check, or a new phone-viewport
e2e step.
