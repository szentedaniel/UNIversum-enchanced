# Ticket #39 (Pick tray checklist and inspect mode): facts for later tickets

Branch `ticket/39-pick-tray` (on `v2-modernization` after `987af53`, #41/#44 merged).

## Pick logic (`apps/web/src/pick/checklist.ts`)

- `ChecklistRow` is a discriminated union: `{kind:"sale", field, sale, auto}`, `{kind:"doubler", field, rent, rentAfter}` (both `number | null` when the view has no option), `{kind:"erasmus", field, steps, bonus}`.
- `saleChecklist(sale, view)` sorts by sale value (cheapest first, tie by Field id) and badges Auto-sell's picks; `singleChecklist(pick)` keeps Board order for the Doubler and sorts Erasmus by `steps` (nearest first, tie by id). Both render `formatCompactMoney` / the existing `pick_*` messages in the component, not here.
- `stepThrough(fields, id, by)` is the ‹ › ring: wraps within `fields`; a current Field outside the list starts at the first (forward) or last (backward) entry; `[]` → `null`. Unit-tested in `test/checklist.test.ts`.

## uiStore (`apps/web/src/stores/ui-store.ts`)

- `checklistOpen` + `setChecklistOpen`, persisted in `localStorage` under **`universum:pick-checklist-open`** (`"1"`/`"0"`). Read and write are wrapped in try/catch and the read guards `typeof localStorage`; storage failure only loses the preference. A fresh browser starts collapsed.
- `inspect` + `setInspect`: inspect mode during a pick. Not persisted.
- `pickFocus` + `focusPick`: the Field a checklist row focused (Board ring + reveal). Kept separate from `selectedField` because `selectedField` opens a card; during a non-inspect pick the card must not open.
- Existing `selectedField`, `salePicks`, `singlePick` unchanged.

## Board (`apps/web/src/board/Board.tsx`, `board.ts`)

- Renderer gained `setInspect(on)`. It only changes the tap filter: with `pick` marks and inspect on, taps consider every Field (so the Field card can open for a non-pickable one); the dimming/pick rings stay.
- `Board.tsx` `onFieldTap`: inspect during a pick → `selectField(id)` (any Field, `null` closes); else Sale toggle / single choose; else the normal card.
- `applySelection()` is the one selection sink: `renderer.setSelected(selectedField ?? pickFocus)` then `reveal` one rAF later with every `[data-board-obstacle]` rect (pan only, never zoom). Board subscribes to both `selectedField` and `pickFocus`.
- `syncPick` tracks the decision key (`sale.key ?? pick.key`). **On a key change (including into/out of a pick) it clears `pickFocus`, turns inspect off and closes the Field card**, so a new decision never inherits the last one's focus/card. Add any later per-decision pick state to this reset.
- The inspect subscription closes `selectedField` when inspect turns off; the tray returns.

## Screens

- `screens/PickChecklist.tsx`: `rows`, `picked`, `onToggle`, `onFocus`; `<ul data-testid="pick-checklist">` of `aria-pressed` row buttons. Sale rows show the sale value and an "Auto-sell" badge; Doubler rows `Rent now → after`; Erasmus rows `N Fields ahead · Passes Start +X`. Row click calls `onToggle` **then** `onFocus` (marks update, then the ring/reveal).
- `SaleTray`/`PickTray` gained `checklistOpen`, `inspect`, `onToggleChecklist`, `onToggleInspect`, `onToggle`, `onFocus`. The two icon toggles sit left of the Turn timer: `data-testid="pick-checklist-toggle"` (`ListChecks`, `aria-pressed`) and `data-testid="pick-inspect-toggle"` (`Info`, `aria-pressed`); the inspect hint is `data-testid="pick-inspect-hint"`. Expanded, the checklist replaces the chips (the commit button and meter stay).
- `Game.tsx`: when a pick is active **and** `inspect && selectedField !== null`, the bottom slot shows `<FieldCard stepThrough={pick.pickable}>` instead of the tray; closing the card brings the tray back. Otherwise the order is Sale tray → single-pick tray → Field card → Turn card.
- `FieldCard` `stepThrough?: readonly FieldId[]`: ‹ › wrap within that list; omitted = the old whole-ring step. Inspect deliberately does not select a pick.
- Messages: `pick_checklist`, `pick_inspect`, `pick_inspect_hint` in all three locales. Rows reuse `pick_doubler_rent`, `pick_erasmus_ahead`, `pick_erasmus_start`, `sale_auto_sell`. Regenerate Paraglide after message edits.
- Gotcha: `react-perf/jsx-no-new-array-as-prop` flags arrays created in a tray and passed as props; `picked` and `rows` are `useMemo`'d in both trays.

## E2E (`apps/e2e/tests/sale-tray.spec.ts`, `pick-tray.spec.ts`)

- Sale: checklist order (Veszprém 180K, Budapest 198K, Berlin 792K), Auto-sell badges, rows toggle the same picks, collapse, camera scale unchanged.
- Erasmus: nearest-first order (Museum 4 ahead before London 29), row selects; the preference survives the next pick **and** a page reload (the Guest rejoins by token).
- Inspect: enabled from the Sale tray; a tap on non-pickable Chance opens the card, ‹ › go to Veszprém → Budapest (pickables only), taps pick nothing, closing and leaving inspect restores tap-to-pick.
- The reload wait must use `Boolean(window.universumTest?.view() && window.universumTest.room().me)`; `?.view() !== null` is true while the hook is undefined.
