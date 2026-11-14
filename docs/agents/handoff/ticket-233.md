# Ticket #233 (E2E: two Guests exchange a quick-chat line): facts for later tickets

Branch `agent/issue-233-e2e-two-guests-exchange-a-quick-chat-line`, parent spec #176, last ticket of the chat
group. Files: `apps/e2e/tests/chat.spec.ts` only. No app code, no test id added, no `helpers.ts` or
`playwright.config.ts` change. The spec runs in CI only (Playwright is not run locally).

## The spec

- One test, `chat.spec.ts`, on two Guests in a started 2-Player game: `startGame(page, browser)` from
  `tests/helpers.ts` (the `creator` project page and the joined `guest`, both registered for the failure dump;
  `closeAfterDump(context)` in `finally`). `test.use({ locale: "en-US" })`, as `bots.spec.ts` does.
- It runs in both single-browser projects (`desktop-chromium`, `iphone-webkit`): the config's `testIgnore` only
  excludes `MIXED`, so the bubble is checked in the wide corner-card layout and in the phone chip layout. The
  joining Guest's context is a fresh desktop one (`createAndJoin` passes only `locale` to `browser.newContext`),
  so `isMobile` describes the creator page only; the spec gives each page its own `Interactor` and the joiner
  `mobile: false` (its presses are clicks).
- Flow: A (`good_luck`) → both screens show the line by A's Seat → it fades on both → B (`cheer`) → A and B show
  the emote by B's card → B mutes `chat-toggle-mute` in the Game menu → B's `chat-toggle` is gone, A's is not →
  A sends a second line (`well_played`) → A's card shows it, B's card for A shows none.

## Seats, cards and language

- `ChatEvent.seat` is the Seat index (#229). The spec reads `{ mine, other }` from `room().push!.view.players`
  once; `PlayerView.seat` is the join order (`setupGame`), and both `PlayerCard` (wide) and `PlayerChip` (phone)
  render the cards in `view.players` order, so `playerCards(page).nth(seat)` is the sender's card in both
  layouts. `bubbleOf(page, seat)` scopes `getByTestId("chat-bubble")` to it.
- Message text is never hard-coded: `send()` reads the pressed `chat-send-<id>` button's `textContent` (a line's
  text in the page's language) and `aria-label` (an emote's accessible label) and the assertions compare with
  those. The emote's glyph is the button's text; both pages are English here, so the labels match.
- A line's button has no `aria-label`; the spec asserts that (`null`) so a changed catalogue that gave lines a
  label would be noticed.

## Timing and mute

- `BUBBLE_MS` is 4 s in `apps/web/src/stores/chat-store.ts` (#230); the fade waits use a local
  `BUBBLE_FADE_MS = 15_000` budget (auto-retrying `toHaveCount(0)`, no sleep) and there is no Playback wait:
  chat is never in the Game view or the Playback.
- Sends from one Guest are more than the Room's `LIMIT_CHATS_PER_SECOND` default (1, `apps/server/src/limits.ts`)
  and the tray's `CHAT_COOLDOWN_MS` (1.2 s) apart: the first line's fade runs before B's send, and A's second
  send comes after the emote and mute steps. `press()` also waits out the button's `disabled` cooldown on a
  reopened tray, so a spec that sends twice from one page needs no fixed wait.
- Mute is a render gate, not a receive gate: `chatOpenTo(view, me, muted)` unmounts `ChatTray` (so `chat-toggle`
  is absent) and `PlayerCard`'s `ChatBubble` returns `null`. The spec therefore cannot observe the muted receive;
  it follows the house negative pattern (`two-guests.spec.ts`'s waiter checks): A's own bubble arriving proves
  the broadcast, then B's card is asserted empty.
- After `chat-toggle-mute` the Game menu dialog is still open. The spec presses the dialog's `Close` button
  (the `DialogContent` close label, `m.close()`) and waits for `chat-toggle-mute` to unmount (`DialogPortal`'s
  `keepMounted` is false) before the bubble checks on B's game screen.

## E2E selectors this spec uses

- `chat-toggle` — the Game status row's tray trigger (`ChatTray`, #231), absent while muted.
- `chat-send-<id>` — one per catalogue id from `CHAT_IDS` (#231), `chat-send-good_luck`, `chat-send-cheer` and
  `chat-send-well_played` here; disabled during the tray's cooldown.
- `chat-bubble` — the `<output>` inside the sender's `player-card` / `player-chip` (`ChatBubble`, #230). A line
  shows its text; an emote shows its glyph plus an `sr-only` label, both in the element's text. `toContainText`'s
  array form takes one entry per matched element, so the one bubble's glyph and label are two separate calls.
- `chat-toggle-mute` — the Game menu's mute button (`ChatMuteToggle`, #232), `aria-pressed` carries the setting.
- `game-menu` — the Game menu trigger (#41), needed to reach the mute toggle.
- `player-card` / `player-chip` — via `playerCards(page)`; the bubble is never outside them.

Read for: any chat bubble, tray, mute or e2e spec that scopes a bubble to a Player card, or any e2e send from one
page twice.
