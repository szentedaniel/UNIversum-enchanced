# Ticket #351 (factory review follow-ups for #350) — extension points and gotchas

Branch `agent/issue-351-factory-review-follow-ups-350`, from `main`.
Follow-up to #350, which merged #257's menu hints switch and re-read list. Test and docs
only: no `apps/web/src`, protocol, rules or server change.

## What changed

- `apps/web/test/game-menu-hints.test.ts` (new) owns the file-level
  `vi.mock("zustand", …)` seam (`useStore` → `getState`, copied from `chat-mute.test.ts`) and
  the `inLanguage`/`beforeEach`/`afterEach` locale helpers. It holds the moved
  `the menu's hint list` describe (six German rows while `seen` holds two ids and the switch
  is off; the switch's label and `aria-pressed` on both sides) and the new
  `the menu's hint controls` describe: pressing `hints-toggle` flips
  `hintStore.getState().enabled` off and back on, and pressing `hints-reset` clears `seen`
  and turns hints on. `press`/`controlWith` walk the returned React element tree, because
  vitest runs without a DOM; `beforeEach` resets `seen`/`enabled` through
  `hintStore.setState`.
- `apps/web/test/hints.test.ts` drops the mock and the menu tests, so `the hint table` and
  `nextHint` run unmocked. It keeps the reset round-trip (`dismiss("offer")` → no hint →
  `reset()` → the Offer hint opens again), which is safe because `hintStore` is a
  `zustand/vanilla` store (the mock only replaced `zustand`) and the round-trip reads
  `getState()`, never `useStore`.
- `GLOSSARY.md`'s **Hint** entry now names the Game menu's switch and its list of every hint
  to re-read, with the reset that makes the dismissed ones appear again.

## Gotchas

- The two hint test files are independent: `vi.mock` is hoisted per file, and
  `game-menu-hints.test.ts` is the only one that mocks `zustand`. A test that needs the
  menu's state as a mounted client reads it belongs there.
- Calling `HintsToggle()`/`HintList()` directly is deliberate: they are plain function
  components, `HintList` uses no hooks and `HintsToggle` only the mocked `useStore`, and
  walking the returned elements (not rendering them) keeps the test out of Base UI's DOM.
- The `hints-toggle` polarity is unchanged: `aria-pressed` is true while hints are on,
  unlike `sound-toggle`/`chat-toggle-mute` (pressed = off). #351 left that for the owner to
  confirm or unify.

## Not touched

`apps/web/src/components/GameMenu.tsx` and every other `apps/web/src` file; no message
file, protocol, rules, server or dependency change. The menu dialog's close button still
scrolls with the body on a phone; that needs a browser, so CI's Playwright keeps it.
