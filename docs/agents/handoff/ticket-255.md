# Ticket #255 (hints: the dismissible card on the Game screen) — extension points and gotchas

Branch `agent/issue-255-game-screen-dismissible-hint-card-with-offer-quara`, from `main`.
Spec #180; builds on #254's table and store. #256 renders the Doubler, Erasmus and
game-end rows; #257 adds the menu switch and the hint list.

## The card (`apps/web/src/components/HintCard.tsx`)

- Props: `{ hint: HintRow | null; place: HintPlace }`, where `HintPlace` is `"bottom" | "tray"`.
  It renders nothing for a null row **or** a row whose place differs, so the caller passes the
  one hint `nextHint` returned and the data decides where it lands.
- `PLACES` (module-private) is the #255 routing table: `offer` and `quarantine` → `bottom`,
  `sale` → `tray`. **#256 extends `PLACES` with `doubler`/`erasmus` → `tray` and
  `gameEnd` → `bottom`; no screen calls change**, because `Game.tsx` already passes the open
  hint to `DecisionTray`.
- Markup: `<aside data-testid="hint-card" data-hint={id} data-board-obstacle>` with the row's
  sentence (`m[row.messageKey]()`, type-checked by #254's `HintMessageKey`) and a dismiss
  `Button` (`data-testid="hint-dismiss"`, `aria-label={m.hint_dismiss()}`). The dismiss calls
  `hintStore.getState().dismiss(hint.id)` in its handler; it is never a `Dialog`, takes no
  focus and pauses nothing.
- `data-board-obstacle` lets the Board's reveal pan away from the card (the same attribute
  `DecisionTray` and `FieldCard` carry). It does not change the camera fit: the fit area comes
  from `--board-inset-*` only.
- New message `hint_dismiss` in `apps/web/messages/{hu,en,de}.json` (`Értem` / `Got it` /
  `Verstanden`); run `pnpm --filter @universum/web run paraglide` after editing.

## Where each hint renders

- `apps/web/src/screens/Game.tsx` reads `seen` and `enabled` with
  `useStore(hintStore, (s) => s.seen)` / `(s) => s.enabled` and calls
  `nextHint({ decision, view, seen, enabled })` right after `openDecision`/`bottomSlot`.
  `decision` is already `null` while the Playback gate is shut, so a hint waits for the gate;
  never pass `push.view` or a timer instead.
- `offer` and `quarantine`: `<HintCard hint={hint} place="bottom" />` sits above `{card}` in
  **both** bottom stacks — the wide `absolute bottom-3` column and the phone's absolutely
  positioned scrolling card wrapper. Both stacks are now `flex flex-col gap-2`; the Decision
  itself stays bottom-anchored, so its buttons do not move when the hint appears and the
  `--board-inset-*` reserve is unchanged. A landscape phone may show the card overlapping the
  Board's bottom edge as the Turn card already does.
- `sale`: `Game.tsx` passes `hint` to `DecisionTray`, which renders
  `<HintCard hint={hint} place="tray" />` after the heading/Turn-timer row and the inspect
  hint, before the picks and the checklist. The pick tray renders it too, but `PLACES` is empty
  for `doubler`/`erasmus` until #256.
- At most one card renders: the bottom slot is exclusive, and `PLACES` makes the two sites
  disjoint.

## Tests

- `apps/web/test/hint-card.test.ts` server-renders the card with `react-dom/server` and
  `overwriteGetLocale` (the `podium-rematch.test.ts` pattern): nothing for a null row, nothing
  for a row in the other place, the three #255 rows in their areas, the #256 rows nowhere, the
  sentence and the labelled dismiss button, and Hungarian copy. A second test renders
  `DecisionTray` from a real `bottomSlot` sale and pins the card inside `sale-tray`.
- No Playwright spec was added or run here (the factory's CI runs the existing specs; the
  first-game hint spec belongs to #257). Selectors for it: `getByTestId("hint-card")`,
  `data-hint="<id>"`, `getByTestId("hint-dismiss")`; a dismissal is stored under
  `universum.hintsSeen` and survives a reload.
- Existing specs interact through roles and test ids anchored at the bottom, so a hint should
  not move their targets. If one does fail, dismiss it through `getByTestId("hint-dismiss")`
  in the spec setup or set `universum.hintsEnabled` to `"0"` with `addInitScript` in
  `apps/e2e/tests/helpers.ts` — record which spec needed it.

## Not touched

No protocol, rules, server or `STATE_VERSION` change; no Playback timer, Turn ring or
`GameMenu` change (#257 owns the switch and the list).
