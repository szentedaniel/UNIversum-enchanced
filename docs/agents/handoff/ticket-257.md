# Ticket #257 (hints: the menu switch and the re-read list) — extension points and gotchas

Branch `agent/issue-257-gamemenu-hints-on-off-switch-and-hint-list-to-re-r`, from `main`.
Spec #180; builds on #254's table and store and #255's card. This is the last ticket of
decision 8: it adds no protocol, rules or server change, and no e2e spec (#258 already
plays the first-game hint flow).

## What changed

- `apps/web/src/components/GameMenu.tsx`:
  - `HintsToggle` (exported, like `ChatMuteToggle`): `data-testid="hints-toggle"`,
    `aria-pressed={enabled}`, label `m.hints_on()` / `m.hints_off()`, a `Lightbulb` /
    `LightbulbOff` icon, and `hintStore.getState().setEnabled(!enabled)`. `aria-pressed` is
    **true while hints are on** — unlike `sound-toggle`/`chat-toggle-mute`, whose `pressed`
    means the feature is off; the label states the setting, so pressed matches it.
  - `HintList` (exported): a `<section>` titled `m.hints_list_title()` holding
    `<ul data-testid="hint-list">` with one `<li>` per `HINTS` row, its text
    `m[row.messageKey]()`, then a `data-testid="hints-reset"` button that calls
    `hintStore.getState().reset()`. The list never filters on `seen` or `enabled`: it is a
    re-read list, so a switched-off or fully dismissed browser still sees the six texts.
  - Game menu order stays: language section, `SoundToggles`, `HintsToggle`,
    `ChatMuteToggle`, `HintList`. The language picker and both sound toggles are where
    `language.spec.ts` and `two-guests.spec.ts` expect them; only the dialog's height class
    changed.
  - `DialogContent` now carries `max-h-[85dvh] overflow-y-auto`, the same shape as
    `ChatTray.tsx`: six hint paragraphs overflow a phone, and the menu must stay scrollable.
    The close button is absolutely positioned inside the popup, so it scrolls with the body
    (as in `ChatTray`); the header scrolls too.
- `apps/web/messages/{hu,en,de}.json`: `hints_on`, `hints_off`, `hints_list_title`,
  `hints_reset`, right after `hint_dismiss`. Hungarian says `Súgó …`, not `Tipp`, because
  `GLOSSARY.md` lists "tip" under the Hint entry's _Avoid_; the owner reviews
  copy per spec #180 decision 6, and `messages.test.ts` pins only key parity.
- `apps/web/test/game-menu-hints.test.ts` (#351 split it out of `hints.test.ts`): a
  file-level `vi.mock("zustand", …)` (the `chat-mute.test.ts` seam: `useStore` → `getState`)
  so the server-rendered menu parts read real store state. `the menu's hint list` describe:
  the six rows match `HINTS.map(row => de[row.messageKey])` with the seen set and switch off;
  the switch's label and `aria-pressed` follow `hintStore.setState({ enabled })`. `the menu's
  hint controls` walks the components' element tree to press `hints-toggle` (both ways) and
  `hints-reset` (seen cleared, hints on), since vitest has no DOM.
- `apps/web/test/hints.test.ts` keeps the table and `nextHint` tests unmocked; its reset
  round-trip (`dismiss("offer")` → no hint → `reset()` → the Offer hint opens again) pins
  acceptance criterion 3 through `nextHint` and reads only `hintStore.getState()`.
- `apps/web/test/hint-store.test.ts` was **not** changed: `reset()` landed with #254 and its
  test already covers the cleared seen set, the switch back on and the stored values.

## Gotchas

- `Game.tsx` already subscribes to `hintStore`'s `seen` and `enabled` and computes
  `nextHint(...)`, so switching off or resetting in the menu re-renders the Game behind the
  dialog; there is no screen call to change. `reset()` while a Decision is open brings the
  hint straight back (same trigger), rather than waiting for the next one.
- `game-menu-hints.test.ts` mocks `zustand` for the whole file. A later test there that wants
  a store's mounted behaviour must set state through `hintStore.setState` (the mock has no
  React subscription), and the mock must keep the `getState` shape. `hints.test.ts` has no
  seam.
- The `hints-toggle` polarity is true = hints on. If a later e2e asserts the sound toggle's
  polarity by analogy, it will be backwards.
- The menu's six rows duplicate the card text by design; there is no per-row test id and no
  "seen" marker (the ticket asks for neither). `data-hint` stays the card's attribute only,
  so a `[data-hint=…]` selector still finds one element at a time.

## Not touched

No store, table, `HintCard`, `Game.tsx`, `DecisionTray.tsx`, protocol, rules or server change;
no new e2e; `language.spec.ts` and the other menu specs are unchanged (CI runs them).
