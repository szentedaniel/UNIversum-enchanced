# Ticket #256 (hints: the Doubler, Erasmus and game-end rows) — extension points and gotchas

Branch `agent/issue-256-game-screen-doubler-erasmus-and-game-end-hints`, from `main`.
Spec #180; builds on #254's table and #255's card. #257 adds the menu switch and the hint list.
The ticket's context named `DecisionTray.tsx`, `Game.tsx` and `hints.test.ts`; by the time it
was built, #255 had put the area decision in `HintCard`'s `PLACES` and #254 had already pinned
every row's trigger, so this diff lands in `HintCard.tsx` and `hint-card.test.ts`.

## What changed

- `apps/web/src/components/HintCard.tsx`: `PLACES` now covers every id and is a
  `Record<HintId, HintPlace>` (it was `Partial`, with `offer`/`quarantine` → `bottom` and
  `sale` → `tray`): `doubler` and `erasmus` → `tray`, `gameEnd` → `bottom`. A `HintId` added
  without a place fails the web typecheck instead of rendering nowhere.
- No screen changed. `Game.tsx` already computes `nextHint` and renders
  `<HintCard hint={hint} place="bottom" />` in both layouts, and already passes `hint` to
  `DecisionTray`, which renders `<HintCard hint={hint} place="tray" />` after the heading/timer
  row and the inspect hint, for both the Sale and the single pick. A `pick` slot and a `sale`
  slot share that wiring, so the Doubler and Erasmus rows need no screen condition.
- `apps/web/test/hint-card.test.ts`: the #255 placeholder ("leaves the Doubler, Erasmus and
  game-end hints to #256") became two placement tests, and a new `the pick tray` describe
  renders `DecisionTray` from a real `bottomSlot` Doubler and Erasmus and pins `data-hint`
  inside `pick-tray`, with the `Got it` dismiss button (`en.hint_dismiss`). `trayOf(view)` is
  the shared Game-slot helper.
- `apps/web/test/hints.test.ts` was **not** changed: #254 already pinned the three rows'
  triggers through `openDecision` (`HINTS` order, the `doubler`/`erasmus` pick trigger, the
  game-end at the first own Roll, the gate wait and the Podium guard). Repeating them would
  cover the same path.

## Gotchas

- The game-end row fires at the viewer's first own Roll (`decision.kind === "roll"`, phase not
  `gameOver`) — keep #254's definition. It shows above the Turn card in the bottom stack, so
  it appears on every own Roll until the Guest dismisses it: the seen set moves only on
  dismiss, there is no auto-hide.
- The table order decides a tie, but at most one row fires per Decision kind, so the pick rows
  and the game-end row never compete.
- `PLACES` is exhaustive; a new `HintId` row needs a place or the web typecheck fails. A
  concept with no area yet (Deals are out of scope per #180) must come with its place.
- The wide bottom strip caps itself at `200px - 0.75rem` whenever `hint !== null` (#255), so a
  hint plus the Turn card or a tray scrolls inside the Board's reserve rather than covering a
  Field. The phone wrapper is capped by `useCardLayout`'s `maxHeight` (the 14rem reserve at
  normal heights). In landscape the card may still sit over the Board, as the Turn card
  already does.
- e2e specs that tap Fields rely on that reserve, not on the card's height: a
  `pick-tray.spec.ts` `showView` pick has the Doubler/Erasmus row as its first hint, the
  table's Podium guard keeps the game-end row off the Podium, and `sale-tray.spec.ts` keeps
  the Sale row. These were not run in this factory run (CI runs them); the reserve is why the
  added card must not move a Field tap.
- Dismissing from the tray works through the same store: `DecisionTray` receives `hint` as a
  prop and `Game` subscribes to `hintStore`, so the card unmounts on dismiss. Do not subscribe
  the tray to the store as well.

## Not touched

No protocol, rules, server or `STATE_VERSION` change; no message added or reworded
(`hint_doubler`, `hint_erasmus`, `hint_game_end` and `hint_dismiss` already exist in hu/en/de);
no `DecisionTray.tsx` or `Game.tsx` edit; `GameMenu`'s switch and the hint list are #257.
