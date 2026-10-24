# Ticket #74 (the Decision module): extension points and gotchas

Branch `ticket/74-decision-module` (on `v2-modernization`), spec #72. One pure
module answers which Decision this client shows, what the bottom slot shows and
what a Board tap does; `Game.tsx` renders from it and derives nothing. The
Board still has its own copy of the Sale/pick reads until #75.

## The module (`apps/web/src/decision/decision.ts`)

- **`openDecision(frame, me, inFlight)`** → `OpenDecision | null`. Reads
  `frame.view` and `frame.gateOpen` only; Sale and pick values come from
  `saleFor`/`singlePickFor`. Returns `null` with no frame, a shut gate, the
  `gameOver` phase, or a Roll/Offer/Quarantine choice in flight; a Sale or pick
  in flight stays with `busy: true`. Another Player's Sale or pick is
  `{ owner, kind }` (the waiting line); their Roll, Offer and Quarantine choice
  is `null`.
- **`bottomSlot(decision, frame, { selectedField, inspect })`** → `none |
  podium | fieldCard { field, stepThrough? } | sale { sale, busy } | pick {
  pick, busy } | turnCard`, in the screen's order: result screen, inspect card
  during my Sale/pick, tray, selected Field's card, Turn card. The `sale`/`pick`
  slots carry the value and `busy` so `Game.tsx`'s switch has no unreachable
  branch (the spec names the tags without payloads).
- **`fieldTap(decision, { inspect }, field)`** → `selectField | toggleSale {
  key, field } | choosePick { key, field } | ignore`. Inspect mode wins over
  `busy`: an inspect tap only opens a Field card and never changes a pick. While
  a busy Sale/pick is not in inspect mode every tap is ignored. A `null` tap
  while picking is ignored; elsewhere it closes the Field card.
- **`decisionKey(decision)`** → my Sale's or pick's `key`, else `null`; ignores
  `busy`, so a send never resets the picks.
- **Type narrowing gotcha:** `PlayerId` is `string`, so `owner === "me"` cannot
  remove the waiting line from the union (its `owner` is a string). Narrow with
  `"sale" in decision` / `"pick" in decision` — only my decisions carry those
  properties. Tests narrow the same way.
- Plain functions of plain data: no React, stores or timers. #75 reads all four
  outside React.

## Game screen (`apps/web/src/screens/Game.tsx`)

- Reads the frame once (`useStore(playbackStore, state => state.frame)`), then
  `view = frame.view`; the early return is `!push || frame === null`.
- `decision` and `slot` are computed after the guard. The Turn card switches on
  `decision` (waiting lines, Roll, Offer, Quarantine); the bottom card is one
  `bottomCard()` switch over `slot.kind` (exhaustive; add a case when
  `BottomSlot` grows — the trailing `return null` is there for Oxlint's
  `consistent-return`). `<Podium>` renders from `slot.kind === "podium"`.
- The tray `busy` and the Sale/pick value come from the slot (which copies them
  from the Decision); `saleFor`/`singlePickFor` no longer appear in the screen.
- `inFlight` is `useStore(roomStore, inFlightOf)` (#73; `sentAt`/`answeredAtOf`
  in `room-store.ts`, set by `sendIntent`). Handlers call `sendIntent` directly;
  do not add another lock here.

## Import fence

- `.oxlintrc.json` has a third override for `apps/web/test/**`: tests run in
  Node and may import `@universum/rules` at runtime (spec #72's Testing
  Decisions needs `setupGame`/`apply`/`publicView`), plus its `board` and
  `playback` subpaths. Protocol root and Zod stay refused. `src/` keeps the
  type-only fence; `apps/web/test/import-fence.test.ts` lints a sample under all
  three copies, so update its `LOCATIONS` if the overrides move.
- `apps/web/test/decision.test.ts` builds views with the real rules (local
  `newGame`/`accept`/`rollOnto`/`playTurn` helpers modelled on
  `packages/rules/test/helpers.ts`) and frames with
  `playbackOfPush({ view, events: [], … }).frameAt(opensAt | opensAt - 1)`.

## For #75 (Board)

- `Board.tsx` still calls `saleFor`/`singlePickFor` (`openView`, `currentSale`,
  `currentPick`) and its own `onFieldTap`; delete them and use
  `openDecision(frame, me, inFlightOf(roomStore.getState()))`,
  `fieldTap(...)` (apply `selectField`/`toggleSale`/`choosePick` to `uiStore`,
  `ignore` does nothing) and `decisionKey(...)` for `syncPick`'s reset key. The
  reset (focus, inspect, open Field card) and the Sale warning timer stay in
  `syncPick`.
- A busy Sale/pick ignores picking taps but still opens Field cards in inspect
  mode — the Board half of "no optimistic UI" (spec story 2).
