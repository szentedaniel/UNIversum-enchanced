# Ticket #317 (Board hover) — extension points

Branch `agent/issue-317-board-onfieldhover-option-with-mouse-only-hover-el`. All paths under `apps/web`.

## Gesture layer (`src/board/gestures.ts`)

- `hoverEligible(input: HoverInput): boolean` is the pure rule. `HoverInput` is `{ pointerType, buttons, dragging, multi, sinceTouch }`: `pointerType === "mouse"`, `buttons === 0`, no drag (`press.moved`), no pinch or second pointer, and `sinceTouch` either `null` or at least `TOUCH_WHEEL_GRACE_MS` (the wheel's 350 ms touch grace, reused deliberately). Touch and pen pointers are false whatever the browser's compatibility mouse moves say.
- `GestureTarget` gained `hover(at: Point | null)`, beside `tap(at)`. It is required; anything mounting `attachGestures` (only `board.ts` in `src`) must pass it. Points are canvas CSS pixels (`clientX/Y - rect.left/top`), like `tap`.
- Wiring: every `pointermove` decides the hover before the press/drag logic (`hoverMove`), `pointerdown` clears it (after the non-left-mouse-button guard), and a new `pointerleave` listener clears it. A `null` is reported only when a point was reported before it (`hovering`), so a press or a leave with nothing hovered is silent; points themselves are not deduped here.
- No `press`, drag, pinch or tap threshold changed: `TAP_MS`, `TAP_SLOP`, `TOUCH_TAP_SLOP`, `TOUCH_WHEEL_GRACE_MS`, `PINCH_MIN_SPREAD` are untouched, and the existing tap/pinch/cancel/wheel tests still pass.

## Board renderer (`src/board/board.ts`)

- `snapField(at, centres, scale, allowed?)` is the one nearest-Field snap. `centres` is in canvas CSS px, indexed by `FieldId`, and already lifted as a tap lifts it (selected or picked Fields sit `SELECTED_LIFT` higher); `allowed` is the tap's pick/inspect filter (`!pick || inspect || pick.pickable.includes(id)`), and leaving it out counts every Field; ties keep the lower Field id. The reach is unchanged: `max(TAP_REACH_PX 90, TAP_REACH_FIELDS 1.6 × FIELD_WIDTH × scale)`, inside the function. `tap()` now calls it, so tap behaviour and the far-tap `null` (which closes the card) are as before.
- `fieldHoverReporter(onFieldHover?)` returns the report function: it fires only when the `FieldId | null` changes, so a stream of moves inside one Field is one call. `createBoard` holds one reporter as `reportHover`.
- `BoardOptions.onFieldHover?(id: FieldId | null)` is the new optional option. The renderer's `hover(at)` snap passes **no** filter: every Field counts, even during a pick, so the next ticket's tooltip works while a Decision is open (hover must not be limited to `pickable`). A hover farther than the tap reach from every Field reports `null`; nothing closes a card.
- Not changed: `Board.tsx`, `uiStore`, `fieldTap`/`openDecision`, the pick tray, the atlas and the camera. `onFieldHover` is optional, so no bridge change was needed.

## Gotchas

- Hover is stale while the pointer is still: a wheel zoom or a camera-button pan moves the Board under the cursor without a `pointermove`, so no re-snap happens until the mouse moves. The tooltip ticket must either accept that or add a re-snap where the camera changes.
- The gesture layer's clear is change-only: a leave fires `hover(null)` only after a point. Do not build behaviour that needs a `null` on every leave.
- A press (including a touch landing during a mouse hover) clears the hover, and it does not return until the mouse moves again after the release.
- `snapField` and `fieldHoverReporter` are importable in a Node vitest: `board.ts` imports PixiJS, which loads without a DOM, and the pure exports never call `createBoard`. `createBoard` itself still needs a real DOM and WebGL, so the renderer wiring is only covered by the gesture-level tests plus CI's e2e.
- Tests: `apps/web/test/hover.test.ts` (the two pure rules plus the reporter; no timers) and the new `hover` describe in `apps/web/test/gestures.test.ts` (7 tests over the fake canvas: mouse-only, press clear, second finger, leave, held-button move, touch grace).
