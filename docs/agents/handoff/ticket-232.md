# Ticket #232 (mute chat in the Game menu): extension points and gotchas

Branch `agent/issue-232-web-mute-chat-in-the-game-menu` (on `main`). One
remembered switch on the Game menu hides the quick-chat tray and every Bubble
on that device. Client-only: no protocol, Room or rules change. Read for: #233,
any chat bubble, tray or Game menu setting touch.

## The setting (`apps/web/src/stores/chat-mute-store.ts`)

- `CHAT_MUTED_KEY = "universum.chatMuted"`, deliberately not `SOUND_MUTED_KEY`
  (`universum.soundMuted`): the sound mute and the chat mute never touch each
  other. `storedMuted()`/`remember()` copy the sound store's `try/catch`, so an
  unavailable `localStorage` reads as unmuted and a refused write still applies
  to the page.
- `ChatMuteState` is `{ muted, setMuted, toggleMuted }`; the store is
  `chatMuteStore`, and `muted` is read once at import, like the sound's, so the
  reload a language switch causes keeps the choice (#41).
- `setMuted` calls `chatStore.getState().reset()` after writing the key: the
  setting **drops** the bubbles on every change, mute and unmute alike. That is
  what keeps a Bubble received while muted from popping up the moment the Guest
  unmutes; the store still records what arrives, per the ticket's render gate.

## The two gates

- `apps/web/src/components/PlayerCard.tsx`: module-private `ChatBubble` reads
  `chatMuteStore` beside `chatStore.bubbleAt` and returns `null` while muted, so
  both `PlayerCard` and `PlayerChip` hide it. It is a render gate, not a receive
  gate.
- `apps/web/src/chat/tray.ts`: `chatOpenTo(view, me, muted)` takes the mute as
  its third argument (beside the seated-Player and `gameOver` checks), and
  `apps/web/src/screens/Game.tsx` reads `chatMuteStore` **above** its early
  returns (a hook after them breaks `react-hooks/rules-of-hooks`) and passes it
  to the one `<ChatTray />` mount in the status row. Muting therefore unmounts
  the tray and its cooldown; nothing else gates sending, because a hidden tray
  is the only sender.

## The menu surface

- `apps/web/src/components/GameMenu.tsx` exports `ChatMuteToggle`, rendered
  after the sound toggle inside `DialogContent`: `data-testid="chat-toggle-mute"`,
  `aria-pressed={muted}`, `MessageCircle`/`MessageCircleOff`, and
  `m.chat_on()`/`m.chat_off()` for the label. It is exported separately because
  the dialog's content is not rendered until it opens, so the SSR markup test
  renders the toggle, not `GameMenu` (the `ChatChoices` pattern from #231).
- Messages `chat_on`/`chat_off` sit after `chat_close` in
  `apps/web/messages/{hu,en,de}.json` ("Gyorscsevegés be/ki", "Quick chat on/off",
  "Schnellchat an/aus"). Run `pnpm --filter @universum/web run paraglide` after
  editing them.
- `GLOSSARY.md`'s `Bubble` entry states the mute behaviour; no new term.

## Tests

`apps/web/test/chat-mute.test.ts` (9 cases) pins the store (default, toggle,
reload, separate key from the sound, refused write, unavailable storage), the
`PlayerCard` SSR markup with the `useStore` seam from `chat-store.test.ts`
(a bubble on screen disappears when muting; a bubble that arrived while muted
stays hidden after unmuting; a later one shows), `chatOpenTo`'s mute argument,
and `ChatMuteToggle`'s `aria-pressed`/label markup. `apps/web/test/chat-tray.test.ts`
passes `false` as the new third argument at its existing `chatOpenTo` calls.
No e2e here: #233's two-Guest spec is the real-press check, and mute's own
press is manual (the house has no DOM test environment, #224).
