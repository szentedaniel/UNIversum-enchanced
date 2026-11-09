# Ticket #116 (the Decision tray): extension points and gotchas

Branch `agent/issue-116-pick-tray-module-…`, from `main`. One tray module owns
the chrome of this client's Sale and single pick; `Game.tsx` no longer wires a
tray's stores or intents. Pure client restructure: no stored state, protocol or
wire change.

## The module (`apps/web/src/screens/DecisionTray.tsx`)

- **Interface:** `<DecisionTray view slot clockOffset seat />`. `slot` is
  `Extract<BottomSlot, { kind: "sale" | "pick" }>`, i.e. the Decision module's
  `sale` or `pick` bottom slot (spec #72); the tray never re-derives the
  Decision. `seat` is the local Player's figure for `TimerRing`, `clockOffset`
  the push's.
- **It owns the stores and the intents.** `checklistOpen`, `inspect`,
  `salePicks` and `singlePick` come from `uiStore` inside the component;
  `AutoSell`, `SellFields`, `PlaceDoubler` and `TravelErasmus` go straight to
  `sendIntent` with `view.turn`. `Game.tsx` passes no callbacks and reads no
  tray state.
- **Shared chrome:** the checklist toggle (`pick-checklist-toggle`), the inspect
  toggle (`pick-inspect-toggle`), the Turn timer (`TimerRing` + `TurnRing`, keyed
  by `turn:turnDeadline`), the inspect hint (`pick-inspect-hint`), the expanded
  checklist (`pick-checklist`) and the chips. `PickChecklist` is now an
  internal function here; `screens/PickChecklist.tsx` is gone.
- **Per-kind body:** `SaleHeading` + `Picks` with amounts + `SaleBody` (sr-only
  meter, bar, `sale-meter-text`, Auto-sell and Sell), or `PickHeading` (the
  chosen option's `pick-effect`) + `PickBody` (the one named commit). The `X`
  chip removes a Sale pick (a toggle) or clears the single pick (`choosePick(key,
  null)`).
- **Test ids are unchanged:** root `sale-tray`/`pick-tray`, plus every id the
  e2e specs read. `data-board-obstacle` and the `sticker` classes stay on the
  root `<section>`.

## Game screen (`apps/web/src/screens/Game.tsx`)

- `bottomCard()` has one case for both trays:
  `case "sale": case "pick": return <DecisionTray … />;`. The switch keeps its
  `return null` for Oxlint's `consistent-return`.
- The screen still reads `selectedField` and `inspect` for `bottomSlot`; it no
  longer reads `checklistOpen`, `salePicks` or `singlePick`.

## For later tickets

- **#125** (deep trays plus a `TurnCard`) proposes separate deep `SaleTray` and
  `PickTray` modules. If it lands after this, `DecisionTray`'s shared chrome is
  the seam to keep: a per-kind module should take `{ view, slot, seat,
  clockOffset }` and leave the toolbar/checklist/chips here, or move them behind
  an internal shared piece rather than copying them back.
- A new tray control or in-flight rule belongs here once, not in `Game.tsx` and
  a kind file. `busy` is `slot.busy` (the Decision's in-flight answer); do not
  read `inFlightOf` again inside the tray.
