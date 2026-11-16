# Ticket #318 (Field tooltip) — extension points

Branch `agent/issue-318-web-hover-tooltip-shows-name-owner-and-rent-next-t`. All paths under `apps/web` unless said otherwise.

## What reads what

- `stores/ui-store.ts` gained `hoveredField: FieldId | null` and `hoverField(field)`, beside `selectedField`/`selectField` and independent of them: the tooltip shows while a card or a tray is open and never takes the bottom slot.
- `board/FieldTooltip.tsx` is the presentational component: props `{ id, view, at }` — the hovered Field, the shown `PublicView` and the Field's centre in viewport CSS px. It renders `data-testid="field-tooltip"`, `aria-hidden="true"`, `pointer-events-none`, and is **not** a `data-board-obstacle`. `fieldFacts` decides `ownable`: a University or Museum gets `Owner: <playerName>` (or `field_card_unowned`) and `Rent: <money>` (or `field_card_none` while unowned); a Chance, Tax or corner Field gets the name only. `view === null` renders nothing, so the numbers can never be made up.
- `board/Board.tsx` wires it: the renderer option `onFieldHover` forwards to `uiStore.hoverField`, the effect's cleanup calls `hoverField(null)` (so a destroyed Board or an unmounted Game leaves no hover), and `HoveredTooltip` subscribes to `uiStore.hoveredField` and `playbackStore.frame.view` and asks the renderer `fieldCenter(id)` for the point. Its own component, so a Playback step re-renders the tooltip without re-rendering the Board.

## Placement

- `placeTooltip(at, size, viewport): Point` is the pure part (`board/FieldTooltip.tsx` exports it): beside the Field on the side that fits, clamped inside the viewport (`GAP` 12 px, `MARGIN` 8 px, a box wider than the viewport keeps the left margin). Pinned by `test/field-tooltip.test.ts`.
- The component measures itself in a `useLayoutEffect` before paint, because the box wraps with its text; the effect's one dependency is `at`, which the Board rebuilds on every parent render, so a new hover, Playback step or camera move re-measures.
- It is `position: fixed` with viewport coordinates inside `.board` (whose `overflow: hidden` does not clip a fixed child; a transformed ancestor would).

## Gotchas

- A camera move without a `pointermove` now re-snaps the hover and re-places the tooltip (#357): `board.ts` keeps the last hover point (`hoverAt`) and `setCamera` ends with `resnapHover`, which re-runs the gesture layer's `snapField` and calls the optional `BoardOptions.onCameraChange`; `Board.tsx` wires that to `uiStore.cameraMoved`, and `HoveredTooltip` subscribes to `uiStore.cameraRevision` (without reading it) so it re-renders and `fieldCenter` gives the Field's new point. `onFieldHover` stays change-only, so a wheel zoom that keeps the same Field reports no hover. A camera button or Follow still clears the hover first — the pointer leaves the canvas for the button — and the tooltip returns with the next mouse move. The old note here accepted the staleness; that is superseded.
- The tooltip reads `playbackStore.frame.view`, never `roomStore.push.view`, so it cannot run ahead of a running Playback (ADR-0004); it does no `clockOffset` or `PLAYBACK_MS` arithmetic.
- Hover reaches every Field during a pick because #317's `hover` snap passes no `allowed` filter; do not narrow it to `pickable`, or the tooltip vanishes over the rest of the Board.
- Touch and pen pointers never raise a hover (#317's `hoverEligible`), so the tooltip needs no touch guard of its own; the Field card stays the accessible path.

## Tests

- `test/field-tooltip.test.ts` (Node, `renderToStaticMarkup`): `placeTooltip`'s four placements and the component's owned / unowned / name-only markup and its no-obstacle, no-pointer-events contract.
- No message key was added: the tooltip reuses `field_card_owner`, `field_card_unowned`, `field_card_rent` and `field_card_none`, so `messages.test.ts` needed no change.
- `apps/e2e/tests/field-card.spec.ts` gained three tests: the desktop hover (unowned Zurich, name-only Chance, leaving the Board hides it, a click through it still opens the card), the tooltip over an open Offer with a `showView` owned Field's Rent, and the touch project's tap and `dragBoard` pan asserting no tooltip.
