# Ticket #230 (chat bubbles by the Player cards): extension points and gotchas

Branch `agent/issue-230-web-show-received-chat-bubbles-by-player-cards` (on
`main`). The client shows an accepted quick chat as a short-lived bubble by the
sender's Player card, in the viewer's language. Read for: #231 (the tray), #232
(mute), #233 (the two-Guest e2e), any new chat id or Game-screen card touch.

## The wire and the store

- `apps/web/src/connection.ts` registers `joined.onMessage(MESSAGE.chat, …)`
  next to the game push and calls
  `chatStore.getState().show(event.seat, event.id, Date.now())`. `ChatEvent.seat`
  is the Seat index (`PlayerView.seat`), not a Player id (#229).
- `leaveRoom()` clears it (`chatStore.getState().reset()`) next to `reset()`, so
  a new join, another Room or leaving shows no bubble. There is no history: a
  reload or a reconnect starts empty, as the server keeps none.
- `apps/web/src/stores/chat-store.ts`: `BUBBLE_MS = 4_000`, `ChatBubble`
  (`{ id, shownAt }`), `ChatState` (`bubbles: ReadonlyMap<number, ChatBubble>`,
  `show`, `bubbleAt`, `expire`, `reset`) and `chatStore`. `show` replaces that
  Seat's bubble; `bubbleAt(seat, now)` answers `null` from `BUBBLE_MS` on even
  before a wake; one module-level timer arms at the soonest expiry and calls
  `expire(Date.now())`, so the screen re-renders without the bubble. Time is
  handed to `show`/`bubbleAt`/`expire`, so `apps/web/test/chat-store.test.ts`
  drives it with fake timers and never sleeps.
- `BUBBLE_MS` is a UI timing, not a Playback length: nothing here imports
  `apps/web/src/playback/`, and ADR-0004's fences (`playback-fence` patterns,
  `server-clock-fence`) needed no change. Keep it that way; the store reads no
  `clockOffset`.

## The catalogue and the text

- `apps/web/src/chat/catalogue.ts`: `ChatFace` (`{ kind: "line", text }` or
  `{ kind: "emote", glyph, label }`), the `Record<ChatId, ChatEntry>` table and
  `bubbleOf(id)`. The table is typed by `ChatId`, so a new protocol id without a
  face fails typecheck; each entry names its Paraglide message explicitly
  (`m.chat_line_…`, `m.chat_emote_…`) — never build a key by concatenation.
- Messages are `chat_line_<id>` (eight lines) and `chat_emote_<id>` (six emotes)
  at the end of `apps/web/messages/{hu,en,de}.json`; the emote messages are
  accessible labels, the glyphs live in the catalogue. After editing messages run
  `pnpm --filter @universum/web run paraglide`; `messages.test.ts` keeps the
  three files' key sets identical, and `apps/web/test/chat-catalogue.test.ts`
  pins that every `CHAT_IDS` entry resolves in hu, en and de.
- Chat text is never user input: the bubble renders the catalogue's string only.

## The display

- `apps/web/src/components/PlayerCard.tsx` exports `ChatPlacement`
  (`below-start | below-end | above-start | above-end`), the `CHAT_PLACEMENT`
  class map, the `useChatBubble(seat)` hook (store read plus `bubbleOf`) and the
  `ChatBubble` node both `PlayerCard` and `PlayerChip` render as their last
  child. `PlayerSummary` stays pure; the bubble is not part of it.
- The bubble is an absolutely positioned `<output>` (implicit `role="status"`,
  which Oxlint's `prefer-tag-over-role` requires over `span role="status"`),
  `data-testid="chat-bubble"`, `pointer-events-none`, so it never shifts the card
  or the Board's fit: it hangs into the space the screen already reserves.
  `PlayerCard`/`PlayerChip` added `relative` for it. A line shows its text; an
  emote shows its glyph (`aria-hidden`) plus the label in an `sr-only` span.
- `apps/web/src/screens/Game.tsx`: `CORNERS` now holds `{ card, bubble }` — the
  wide corner cards hang their bubble below the top cards and above the bottom
  ones, pointing inward. The phone chips pick by half of the strip
  (`index < players.length / 2 ? "below-start" : "below-end"`), so a bubble never
  runs off the edge; the expanded card uses the default `below-start`.
- The fade is `apps/web/src/styles.css`'s `.chat-bubble`: `animation-name` only,
  the duration inline from `BUBBLE_MS`, so the fade ends as the store drops the
  node. The global reduced-motion rule excludes `.chat-bubble` and sets its
  `animation: none`, so the bubble holds still and simply disappears.

## What this does not do

- No sending: the tray and its cooldown are #231, mute is #232, the two-Guest
  Playwright spec is #233. `apps/web/test/` has the unit tests only; the UI is
  verified by hand here and by #233 in CI.
