# Ticket #263 (Board touch gestures) — extension points

Branch `agent/issue-263-board-touch-gesture-and-zoom-polish-as-pure-camera`. All paths under `apps/web`.

## Gesture decisions (`src/board/gestures.ts`)

- `attachGestures(el, target, options?)` takes `GestureOptions.now` (default `performance.now`); tests pass a fake clock, so a press's age is measured without timers. `GestureTarget` is unchanged: `camera`, `move`, `scaleLimits`, `tap`, `moved`.
- Two records, one press. `Press` (`start`, `at`, `slop`, `moved`, `multi`) lives from the first pointer down to the last pointer up; `Baseline` (`camera`, `mid`, `spread`) is re-read on every `pointerdown` and on every `pointerup` that leaves fingers down. A move applies the whole delta from the baseline, so a second finger landing mid-drag or one finger lifting from a pinch rebases the gesture instead of jumping the camera.
- Constants: `TAP_MS = 500`; `TAP_SLOP = 10` (mouse/pen, the prototype's value); `TOUCH_TAP_SLOP = 18` (`pointerType === "touch"`, whose contact patch rolls); `PINCH_MIN_SPREAD = 24` (spread floor, so two fingers landing on one point cannot divide by zero); `TOUCH_WHEEL_GRACE_MS = 350`.
- A second pointer sets `Press.multi`: the press is a pinch or pan and never a tap. `pointercancel` ends the whole press (clears every pointer) and fires no tap and no `moved`; later moves for the fingers still down are ignored. A new `pointerdown` starts a fresh press.
- `moved()` fires once per press: when the midpoint leaves the press's slop, or on the first move after a second finger landed. It is the Board's `atFit = false` + follow-off signal; do not add a second call path.
- The wheel is ignored while a touch pointer is down and for `TOUCH_WHEEL_GRACE_MS` after one (a synthetic pinch's wheel or momentum), but still calls `preventDefault()` so the page never scrolls or page-zooms. The mouse wheel is unchanged.
- `tap(at)` still receives canvas CSS pixels (`clientX/Y - rect.left/top`); the Decision tray's `fieldTap` contract did not change.
- Scale clamping is still the target's `scaleLimits()`. The Board still clamps the camera's position in `board.ts` (`setCamera` → `clampCamera`); do not duplicate the position clamp in gestures.

## Camera maths (`src/board/camera.ts`)

- `gestureCamera(camera, from, to, limits)` is the pure step behind every move. `from`/`to` are `GestureSpan = { mid, spread }` in canvas px. It zooms by `to.spread / from.spread` (0 spread = pan only), clamps the scale to `limits`, and pans so the Board point under `from.mid` lands under `to.mid` (`zoomAround` plus the midpoint delta). Position clamping stays with `clampCamera`, not here.

## Canvas wiring

- Nothing in `Board.tsx` or `board.ts` changed: `board.ts` calls `attachGestures(app.canvas, …)`; `Board.tsx` only reveals and taps. `.board canvas` already has `touch-action: none` (`styles.css`), so the browser does not scroll or zoom the page from the Board.

## Tests (`test/gestures.test.ts`)

- A fake canvas (`addEventListener`/`removeEventListener`/`getBoundingClientRect`/`setPointerCapture`) plus `eventOf`, the one cast boundary where a Node object stands in for `PointerEvent`/`WheelEvent`. Seeded sequences call `down`/`move`/`up`/`cancel`/`wheel`; assertions are on the `GestureTarget` calls (`camera()`, `move`, `tap`, `moved`, `scaleLimits`), never on a private helper.
- Coverage: touch vs mouse slop and `TAP_MS`, tap coordinates in CSS px, pinch midpoint and scale limits, two fingers on one point, second-finger and finger-lift rebasing, `pointercancel`, and the touch wheel grace (17 tests).
- Read for: any new gesture, tap slop, zoom limit, pointer-cancel handling or wheel-zoom change. `apps/e2e/tests/field-card.spec.ts` still covers the mouse wheel and the camera buttons in CI.
