# Ticket #77 (R74 countdown tests) — what pins R74 and what to watch

Branch `ticket/77-r74-countdown` (on `v2-modernization`), spec #22, a follow-up
of the #47 parity check. Tests only: no production file, message, rule or
`STATE_VERSION` changed.

## What pins R74 now

- **`apps/web/test/game-hud.test.ts`** — four `it("R74: …")` cases on the
  exported `formatClock` (`apps/web/src/components/GameHud.tsx`): `m:ss` with
  zero-padded seconds, a partial second rounded up, `0` and negative time as
  `0:00`, and minutes past 9 kept whole (`50:00` for a 50-minute Room). The
  import goes through the app's `#` alias: `#components/GameHud.tsx`. It is a
  plain module import in the Node test project, not a render.
- **`apps/e2e/tests/tabletop.spec.ts`**, `test("R74: …")` — starts a 2-Guest
  game with `startGame` (so it runs in both `desktop-chromium` and
  `iphone-webkit`), then:
  - reads the pill's text with `getByTestId("minute-pill")`; its `innerText`
    also carries the `sr-only` label, so match `(\d+):(\d{2})` — a leading `\b`
    fails against `"Game time left2:00"`;
  - compares it to `room().push.view.endsAt - serverNow()` within ±2 s (the
    display is a whole second rounded up, rendered up to a tick before the clock
    is read);
  - `expect.poll`s until the text goes down. No fixed sleep.
- **`packages/rules/test/coverage.test.ts`** — R74 stays in `OUT_OF_SCOPE` (the
  scan reads only `packages/rules/test`); its reason now names both tests above
  instead of "the Playwright seam".

## Gotchas

- **The e2e game is a 50-minute Room, not a 15-minute one.** The create form
  defaults to 50 and `helpers.ts`'s `createAndJoin` only picks the Player count;
  with `GAME_MINUTE_MS=8000` that makes `endsAt` 400 s after Start and the pill
  start near `6:40` (not the `2:00` a hand-picked 15 would give). Assert against
  `endsAt`, never a minute count.
- **`apps/web/tsconfig.node.json` sets `jsx: "react-jsx"`.** The Node-side
  project typechecks `test/`; importing a component without it fails both
  `oxlint --type-check` (TS6142) and `tsc -p tsconfig.node.json`. Any later web
  vitest that imports a `.tsx` module needs that setting, not a copy of the
  component's logic.
- **E2E needs `CI=true` and the `TEST_HOOKS=1` build for game specs.** With `CI`
  unset Playwright serves Vite dev, whose HMR WebSocket is counted by
  `probeSockets`, so every `startGame`/`createAndJoin` fails with "opened 2
  WebSockets to join". That is a dev-server artefact, not a broken spec; run the
  game specs the way CI does.
- **The new tests have teeth.** Mutation-checked, then restored: `Math.ceil` →
  `Math.floor` fails the round-up case; adding 600 s to the pill's `endsAt`
  fails the upper bound; a 60 s `setInterval` fails the decrease poll.

## Read for

#47 parity follow-ups, any Minute pill or server-clock touch, and any new
`tabletop.spec.ts` assertion that starts a game.
