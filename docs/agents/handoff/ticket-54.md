# Ticket #54 (a failed e2e test carries each page's game state) — extension points and gotchas

Branch `ticket/54-e2e-failure-state` (on `v2-modernization`). Builds on #53's
shared `apps/e2e/tests/helpers.ts`. Version: #58.

## The fixture

- **Import `test` from `./helpers.ts`, not `@playwright/test`.** The exported
  `test` is `base.extend` with two auto fixtures: `failureDump` resets the
  page registry, and on a failed test attaches one JSON per registered page
  before closing what the spec handed over; `pageErrorGuard` (#62) fails a test
  whose pages threw. `expect` still comes from `@playwright/test`. Every game
  spec uses it; a spec that keeps `@playwright/test`'s `test` silently loses
  both.
- The fixture **depends on `page`** on purpose: fixtures tear down in reverse
  setup order, so the dump runs while the default page's context is still open.
  Dropping the dependency would close that context before the dump in every
  spec whose creator is the `page` fixture.
- `{ auto: true, timeout: 30_000 }`: the per-fixture timeout keeps teardown (the
  dump) running even when the test itself timed out; without it Playwright skips
  teardown of an exhausted test. Keep it generous — teardown also closes
  browsers.

## Registering pages

- `registerPage(name, page)` — `name` becomes the attachment name (`<name>.json`).
  Registering the same name again replaces it, for a page a spec reopens
  (reconnect, full-game's drop). `startGame` registers `creator` and `guest`
  itself; full-game registers each `Guest.name`; two-guests registers
  `desktop`/`phone`.
- `closeAfterDump(contextOrBrowser)` — the spec hands its context or launched
  browser to the test instead of closing it in `finally`. **A page a spec closes
  itself before the test ends is not dumpable**: its attachment records the
  error, not the state. Never put `context.close()` / `browser.close()` back in
  these specs' `finally` without a reason.
- A page closed deliberately mid-test (`page.close()` for a reconnect) is fine;
  re-register the page opened in its place. The registry is module scope, reset
  by the fixture at every test start (one spec file's tests run one at a time
  in one worker).

## What an attachment holds (`PageDump`)

`dumpPage(name, page)` builds it from `window.universumTest` plus the DOM:

- `player` (`room().me`), `status`, `rejection`;
- `push: { seq, clockOffset, events: type[] }`;
- `view: { turn, currentPlayer, phase, actsAfter, version }`;
- `playback()` (now includes `shownTurn` in `tests/test-hooks.ts`);
- `buttons`: labels (`aria-label` or text) of the buttons visible by layout;
- `now` (the page's `Date.now()`), `url`, and `error` when the page was
  closed, had no hooks, or did not answer within 2 s.

`dumpPage` never throws: the dump must not replace the failure it explains.

## Where to read it

The list reporter does **not** print `application/json` attachments that carry
a body (`lib/runner`'s print rule: path or `text/*` only), so `test-results/`
holds no dump files. Read them in the HTML report's test **Attachments**
(`apps/e2e/playwright-report/index.html`, the base64 zip also holds
`data/<id>.json` with the bodies), or re-run with `--reporter=json` and read
`results[].attachments[].body` (base64). Trace stays `retain-on-failure` and is
unaffected.

## Tests

- `tests/failure-dump.spec.ts` (runs in both single-device projects): the dump's
  shape against a live game, and the blank/closed-page error records. The
  attach-on-failure path needs a failed test, so prove it as #54's acceptance
  criterion says: break an assertion in a game spec, run it, read the report,
  revert.
- `pick-tray`, `sale-tray` and `podium` now use the shared `startGame` (their
  local copies are gone); they wait for both Boards, so a broken guest join now
  fails setup instead of silently passing.
