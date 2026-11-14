# Ticket #231 (quick-chat tray sends lines and emotes): extension points and gotchas

Branch `agent/issue-231-web-quick-chat-tray-sends-lines-and-emotes` (on `main`).
The Game screen's tray is the sending half of quick chat (#176): a seated
Guest taps a catalogue id, `sendChat` puts it on the wire, and the Room's
broadcast brings it back as the bubble #230 draws. Read for: #232 (mute), #233
(the two-Guest e2e), any chat tray, cooldown or Game status-row touch.

## The send

- `apps/web/src/connection.ts`: `sendChat(id: ChatId)` beside `sendIntent`,
  `room?.send(MESSAGE.chat, { id } satisfies ClientChat)`. It sets **no**
  in-flight lock (`markIntentSent` is `sendIntent`'s alone): chat is not an
  intent and must not block the Board. No Room means no-op.
- A `SLOW_DOWN` Rejection comes back through the existing path:
  `receiveRejection` bumps `seq`, `Game.tsx`'s `rejected` check shows it in the
  one toast. Nothing chat-specific is needed.
- Import only `@universum/protocol/messages` (`CHAT_LINES`, `CHAT_EMOTES`,
  `ChatId`, `MESSAGE`, `ClientChat`); the catalogue's display text still comes
  from `#chat/catalogue.ts`'s `bubbleOf(id)`.

## The tray's behaviour (`apps/web/src/chat/tray.ts`)

- `ChatTrayState` is `{ open, cooling }`; `CLOSED_TRAY` is the initial state.
  `openTray`/`closeTray` toggle `open` and keep `cooling`; `cooldownOver`
  clears `cooling`.
- `tapChat(state, id, send)` is the whole tap: it calls the injected `send`
  with the id and returns `{ open: false, cooling: true }`; while `cooling` it
  returns the state unchanged and sends nothing. The component's `onPick` is
  exactly `setTray(tapChat(tray, id, send))` — **do not move `send` into a
  state updater**, React may run an updater twice.
- `chatOpenTo(view, me)` is the mount condition: `me !== null`, a Player in
  `view.players`, and `view.phase.kind !== "gameOver"`. It is the one place
  #232 adds its mute check (or add `&& !muted` at the single mount below).
- `CHAT_COOLDOWN_MS = 1_200` lives in `apps/web/src/stores/chat-store.ts` beside
  `BUBBLE_MS`, both UI timings and not Playback lengths (ADR-0004). It sits just
  above the Room's one-chat-per-second ladder (`LIMIT_CHATS_PER_SECOND = 1`), so
  a Guest tapping again normally waits for the buttons instead of a
  `SLOW_DOWN`. The component's one `setTimeout` clears `cooling`; it is cleared
  on unmount.

## The surface (`apps/web/src/components/ChatTray.tsx`)

- `ChatTray` renders a `Dialog` (the house's `components/ui/dialog.tsx`, as
  GameMenu and EventLog do): `DialogTrigger` is the status row's button,
  `data-testid="chat-toggle"`, `aria-label`/title `chat_open`. The dialog is
  **modal**: the game is dimmed and the decision controls are blocked while it
  is open, so it can never race the Sale/offer/pick trays; it closes on Escape,
  an outside tap and its X button (the built-in one, relabelled `chat_close`
  through `DialogContent`'s new `closeLabel` prop). `max-h-[85dvh]` with
  `overflow-y-auto` keeps it inside a landscape phone (where the body scrolls).
- Every catalogue id is one button, `data-testid="chat-send-<id>"`, in
  `CHAT_IDS` order: `CHAT_LINES` in a two-column grid of text buttons, then
  `CHAT_EMOTES` as 44 px glyph buttons with the catalogue label as `aria-label`.
  There is no text input. Tapping calls the injected `send` (default
  `sendChat`) and closes the tray.
- `ChatChoices({ cooling, onPick })` is the exported dialog body so the SSR
  markup test can render it: the house has no DOM test environment (#224), so
  the model plus markup pin the tray and the real press is #233's spec.
- `Game.tsx` mounts `<ChatTray />` once, in the shared `statusRow` (both
  layouts), between the Event log and the Game menu, behind `chatOpen` from
  `chatOpenTo(view, me)`. The Lobby draws no Game screen, so it gets none; the
  Podium's `gameOver` phase and a spectator's missing Seat get none either.
  Chat works in any phase, another Player's Turn included.
- Messages `chat_open`, `chat_close`, `chat_lines`, `chat_emotes` in
  `apps/web/messages/{hu,en,de}.json`; regenerate Paraglide after any edit.

## Tests and the e2e

- `apps/web/test/chat-tray.test.ts` (15 cases): the markup lists exactly
  `CHAT_IDS`, once, with no input/textarea/contenteditable, each line's text
  and each emote's glyph + label, the two headings in hu/en/de, every button
  disabled while cooling; `tapChat` sends each id and closes and refuses while
  cooling; `openTray`/`closeTray`/`cooldownOver`; `chatOpenTo` seated,
  spectator/gone/null and `gameOver`; and `ChatTray`'s SSR toggle markup.
- `apps/web/tsconfig.node.json` needed no change (`jsx` was already on).
- #233's spec uses `chat-toggle`, `chat-send-<id>` and #230's `chat-bubble`.
  Two sends from one Guest need about a second between them (`#229`: the flood
  meters read the real clock), or a raised `LIMIT_CHATS_PER_SECOND`, even
  though the client cooldown is 1.2 s.
- Manually checked in the real dev app (four-Seat room with Bots): the tray
  opens, lists 8 lines and 6 emotes, a tap closes it, the sender's own card
  shows the bubble after the Room's broadcast, and a reopened tray shows all
  buttons disabled for the cooldown. Fits 320×568 and 375×667 uncut, and
  667×375 scrolls inside the popup.
