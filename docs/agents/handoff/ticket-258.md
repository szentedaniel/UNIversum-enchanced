# Ticket #258 (E2E: the first-game Offer hint) — extension points and gotchas

Branch `agent/issue-258-e2e-first-game-offer-hint-shows-stays-dismissed-an`, from `main`.
Spec #180 (the E2E part of Decision 8(d)); builds on #254's table/store and #255's card.

## The spec (`apps/e2e/tests/first-game-hints.spec.ts`)

One test, run by the two single-browser projects (desktop Chromium, iPhone WebKit):

1. `startGame(page, browser, { turnLimitMs: 30_000 })`; the creator is Seat 0 and
   rolls first. With `GAME_SEED` (`4,29,55,129`) the creator's first Roll lands on
   Field 10 with three Level offers (checked against the rules engine: a Level-1
   offer at 340,000).
2. Press Roll, wait for the pushed view's phase to be `offer`, then for
   `window.universumTest.playback().gateOpen` (timeout `ROLL_PLAYBACK_MS + 1000`).
   The hint waits for the gate, so assert it only after both.
3. The Offer's hint: `getByTestId("hint")` has `data-hint="offer"`, and its dismiss
   `getByTestId("hint-dismiss")` is named `Got it` (en-US).
4. `offer.getByRole("button").first()` is the Level-1 Buy. A `click({ trial: true })`
   runs Playwright's actionability checks (scrolled into view, receives the pointer)
   without sending the Offer, so the hint is proven not to cover Buy.
5. Dismiss, assert the card leaves and the Offer stays open.
6. `page.reload()` on the same page (the context keeps `localStorage`; no new
   context), wait for the Offer again, and assert no hint: the seen set came back
   from `universum.hintsSeen`, and the reload rejoined by Guest token.

## Gotchas

- **The Bot race is why the guest goes offline before the reload.** A running game
  answers a dropped Seat's open Decision with a Bot `BOT_DELAY_MS` (1,500 ms) after
  the drop (`GameDriver.#botPlays`/`#armBot`), but only while another Guest's Seat is
  connected (`#guestsConnected`). The creator is the current Player at the reload, so
  without the guest offline the Bot could buy/decline the Offer before the Guest-token
  rejoin lands. `context.setOffline(true)` on the guest plus waiting for its
  `reconnect-overlay` makes the Room's `refreshBot` see no connected Guest and arm
  nothing. A spec that reloads the current Player's screen in a running game needs
  the same guard.
- A 30 s Turn (the Create screen's max) leaves the reload and the rejoin inside the
  Offer's timer; the default 20 s was left alone.
- The `gameEnd` hint also fires at the creator's first own Roll (the table's order and
  its first-own-Roll trigger), so a hint card is already on screen when the spec
  presses Roll. It disappears while the Roll is in flight; the Offer's card is
  identified by `data-hint="offer"`, never by "a hint is visible".
- The first non-null hint row is the Offer's, because the `gameEnd` trigger is false
  once the phase is an Offer; do not assert the whole text (the owner's tone review is
  still open), assert the id.
- e2e was not run in this factory run (the PR's CI runs it). The seed assumption above
  was verified through `setupGame`/`apply`, not through Playwright.

## Not touched

`apps/e2e/tests/helpers.ts` (no new shared step), the web app, the protocol, the rules
package, `STATE_VERSION`, messages, and workflows.
