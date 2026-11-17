# Ticket #357 (Field tooltip follow-ups) — extension points

Branch `agent/issue-357-factory-review-follow-ups-356`. All paths under `apps/web` unless said otherwise.

## A camera move re-places the tooltip

- `board.ts` keeps `hoverAt`: the last point the gesture layer reported a hover at, in canvas CSS px, or `null` when nothing is hovered. Every clear it reports — a `pointerleave`, a press, an ineligible move — reaches it through the same `hover` callback, so a touch pointer can never leave a point there.
- `setCamera` ends with `resnapHover()`: with no hover it does nothing; with a hover it re-runs the gesture layer's own `snapField(hoverAt, fieldCentres(), camera.scale)` (still no `allowed` filter, so the tooltip works during a pick) and then calls the new optional `BoardOptions.onCameraChange()`. `onFieldHover` keeps `fieldHoverReporter`'s change-only contract, so a wheel zoom that keeps the same Field reports no hover at all — only `onCameraChange` fires.
- The gesture layer's `moved()` (a drag, a pinch or a wheel) turns Follow off by hand but clears no hover; before #357 a wheel therefore left the tooltip stale until a `pointermove`. Only a `pointerleave`, a press, or a move the layer judges ineligible (a drag, a pinch, a touch, or a mouse still inside the touch grace) reports `hover: null`.
- `uiStore.cameraRevision` / `cameraMoved()` is that change notification: `Board.tsx` wires `onCameraChange` to `cameraMoved` and `HoveredTooltip` _subscribes_ to `cameraRevision` without reading it, so the component re-renders, `fieldCenter(field)` gives the Field's new screen point, and the existing `useLayoutEffect` keyed on `at` re-measures and re-places. No `pointermove` arrives after a wheel, a pan or fit tween, a Follow ease or a resize.
- `onCameraChange` fires only while a Field is hovered, so an idle camera notifies nothing and no component re-renders per frame without a tooltip on screen.
- A camera button or the Follow button still clears the hover before it moves anything: the buttons sit over the canvas, so moving the mouse onto one fires the canvas's `pointerleave`. The tooltip comes back with the next mouse move onto the Board.

## Placement

- `placeTooltip`'s x and y now go through one private `clamp(value, size, viewportSize)` in `FieldTooltip.tsx`. Behaviour is unchanged; the oversized-box case (the near margin wins on both axes) is pinned in `test/field-tooltip.test.ts`.
- `Size` and `FieldTooltipProps` are no longer exported: nothing outside the file imported them. `placeTooltip` and `FieldTooltip` stay exported for `apps/web/test/field-tooltip.test.ts`.

## Tests

- `apps/web/test/field-tooltip.test.ts` (Node, 11 tests): the five `placeTooltip` placements, the tooltip's owned / unowned / name-only markup and its no-obstacle, no-pointer-events contract, and `describe("uiStore.hoverField(null)")` / `it("clears the hovered Field for its subscriber")` — `hoverField(null)` reaches a subscriber, which is what `Board.tsx`'s effect cleanup calls when the Board or the Game unmounts. The test pins only the store's side of that cleanup; there is no DOM test environment (#224), so the Board itself cannot be mounted in a unit test, and the camera wiring is covered by the e2e below.
- `apps/e2e/tests/field-card.spec.ts`: `rollOntoOffer(page)` is the one roll-and-wait-for-the-Offer step (the owned-University and tooltip-over-Offer tests use it); the hover test adds a Tax Field to the Chance as a name-only Field; `a wheel zoom under a resting pointer moves the tooltip with the Field` pins the re-place, using `tooltipGap` to measure the box's 12 px gap from the Field's _current_ centre; `the tooltip shows over a Sale pick…` pins a hover over a picked Field while the Sale holds the bottom slot, and that a click through the tooltip picks instead of opening the Field card.
- `apps/e2e/tests/helpers.ts` owns `showSale` and `SALE_FIELDS` now, moved out of `sale-tray.spec.ts`, which imports them: one made-up Sale fixture for both specs.

## Gotchas

- `uiStore.cameraRevision` is a render trigger, not state anyone reads. Drop the `HoveredTooltip` subscription and the tooltip is stale again after a wheel, with no other test failing.
- `resnapHover` runs inside `setCamera`, which fires on every frame of a pan/fit tween and on each Follow ease: keep it behind the `hoverAt === null` guard, and keep `reportHover` change-only, or a resting mouse over a walking board re-renders the tooltip with the same Field every frame.
- Under a wheel the hovered Field cannot change: the zoom anchors on the cursor, so every Field's distance from it scales by the same factor. The identity re-snap in `resnapHover` matters for camera _pans_ (a fit tween, Follow), not for zooms — the wheel test pins the moved point, not a Field flip.

## Not done, on purpose

- Touch pinch needs no tooltip case: #317's `hoverEligible` is the only gate, and ticket #318 recorded the deviation.
- No seed hook for a Sale in `field-card.spec.ts`: the spec fakes the view through the shared `showView` fixtures instead.

## #387 follow-up (the advisory findings on #385)

- The hover-reset test is now `describe("uiStore.hoverField(null)")` / `it("clears the hovered Field for its subscriber")`: it pins the store's side of `Board.tsx`'s cleanup only. No e2e replaces it — the Game screen has no leave control, so "hover, leave the Game, assert no tooltip" has no path through the screen the helpers drive.
- `tooltipGap` reads its 12 px from a `TOOLTIP_GAP` constant whose comment names `GAP` in `apps/web/src/board/FieldTooltip.tsx`. The e2e package has no dependency on `@universum/web`, so exporting `GAP` would mean a new cross-app import for a number; the two stay in step by hand.
- New e2e `a zoom-out and a fit move the tooltip with the Field under a resting pointer` (`field-card.spec.ts`, desktop): the camera buttons are pressed from the keyboard (`locator.press("Enter")`), because a mouse click moves the pointer onto the button and its `pointerleave` clears the hover before the camera moves. Only the fitted Board's zoom-out and the fit tween are observable: a fitted zoom-out is clamped to the 0.9 limit, so every Field moves a tenth of its distance from the Board centre (≥ 51 Board units for the Fields nearest that centre) and the hover survives; a 1.5-step zoom moves the hovered Field at least half its distance (≥ 257 Board units) past `snapField`'s 206-unit reach, so the hover legitimately clears mid-tween and there is no tooltip left to re-place. Follow is the same case: `setFollow(true)` jumps to the 2.6 zoom at once, which clears the hover before the ease starts.
- New e2e `a touch tap picks a Sale Field, opening neither its card nor a tooltip` (iPhone project): `tapField` picks Berlin in the shared `showSale` fixture, and the Sale's Decision keeps the Field card shut; a touch pointer raises no tooltip (#317).
