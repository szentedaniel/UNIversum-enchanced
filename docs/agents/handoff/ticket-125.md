# Ticket #125 (tray and Turn card ownership): extension points and gotchas

Branch `agent/issue-125-pick-and-sale-trays-and-the-turn-card-own-their-ui`,
on `main`. This is an architecture pass, not a feature: the Sale and pick trays
and the Turn card now read `uiStore` and send their own intents, and `Game.tsx`
only reads the frame/room store, lays the screen out and switches on
`BottomSlot`. Behaviour, test ids and messages are unchanged; the e2e specs are
the check.

## Tray prop surface (`screens/SaleTray.tsx`, `screens/PickTray.tsx`)

- Both take `{ view, slot, seat, clockOffset }`. `slot` is the narrowed
  `BottomSlot` entry (`Extract<BottomSlot, { kind: "sale" }>` /
  `{ kind: "pick" }`), so it carries the value and `busy`.
- `SaleTray` reads `uiStore.salePicks` and derives the picks with
  `salePicksFor(salePicks, sale.key)`; it sends `AutoSell` and
  `SellFields { fields: picked }` itself.
- `PickTray` reads `uiStore.singlePick` and the choice with
  `selectedPick(pick, selection)`; it sends `PlaceDoubler` / `TravelErasmus`
  by `pick.kind`.
- Both still read `uiStore.checklistOpen` for the checklist-vs-chips body.
  `inspect` is read only by the shared header, and `bottomSlot` in `Game.tsx`
  still reads it for the Field-card branch.
- A new tray control sends through `sendIntent` from the component, with
  `view.turn`; there is no callback prop to `Game.tsx`. The in-flight lock is
  still only `#connection.ts` (`inFlightOf`, #73).

## Shared header (`screens/TrayHeader.tsx`)

- One internal component: the checklist toggle, the inspect toggle, the Turn
  timer (`TimerRing` + `TurnRing`) and the inspect hint. It takes
  `{ view, seat, clockOffset, children }`; `children` is the tray's heading and
  effect line, so the `flex items-center gap-3` row and the hint below it exist
  once.
- It owns the `uiStore` writes (`setChecklistOpen(!checklistOpen)`,
  `setInspect(!inspect)`); both `data-testid`s
  (`pick-checklist-toggle`, `pick-inspect-toggle`) and
  `pick-inspect-hint` are unchanged.
- `PickChecklist.tsx` stays the presentational list only.

## Turn card (`screens/TurnCard.tsx`)

- Takes `{ view, decision: OpenDecision | null, shownTurn: TurnLabel,
  waiting: "sale" | "pick" | null }`. It sends `Roll`, `BuyLevel`,
  `BuyMuseum`, `Buyout`, `DeclineOffer`, `RollForTwelve`, `BuyPcrTest` and
  `UsePcrTest` itself; `OfferPanel` and `quarantineRoundsOf` moved with it.
- It reads `me` from `roomStore` for the "Your Turn" heading; `Game.tsx` no
  longer passes it. `shownPlayer` still falls back to the current Player.
- `waiting` is `waitingLine(decision)` from `#decision/decision.ts` (#76); the
  literal union is duplicated on purpose so `TurnCard` need not import the
  function's value.
- `Game.tsx` renders it from `case "turnCard"`; it is the last slot in
  `bottomSlot`'s order, as before.

## Gotchas

- React's server renderer (`renderToStaticMarkup`) reads a zustand store's
  **initial** snapshot, not `getState()`; an SSR smoke cannot prove a store
  read. Use the browser/e2e for that.
- `react-perf/jsx-no-new-array-as-prop`: `picked` and `rows` stay `useMemo`'d
  in the trays (a new inline array would be flagged).
- The `Game.tsx` e2e hooks and selectors did not move: `turn-of`, `turn`,
  `offer`, `sale-waiting`, `pick-waiting`, `sale-tray`, `pick-tray`, the
  checklist toggles, the meter and the chips all render from the same places
  in the tree.
