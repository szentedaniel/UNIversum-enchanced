# Ticket #67 (the Board seeks the Playback): extension points and gotchas

Branch `ticket/67-board-seeks-playback` (on `v2-modernization`), spec #63. The
Board has no Playback of its own: each animation frame asks the push's core
(`currentPlayback().frameAt(Date.now())`) where the pawns are and puts them
there.

## The Board (`apps/web/src/board/board.ts`)

- **`update(playback: Playback)`** — the signature changed from
  `update(view, events)`. `Board.tsx` hands it `currentPlayback()`, the store's
  one core for the latest push (built before the Board's `roomStore.push`
  subscription runs, so the two always match). The view's Fields, owner rings,
  houses and Field notes still change at once; only the pawns seek.
- **The render loop** (`frame`) reads `frameAt(Date.now())` on every frame —
  the DOM's clock, never the frame callback's `performance.now()` timestamp
  (that one still drives the camera tween). `placePawns` maps each
  `frame.pawns` entry to `fieldPoint(field)`/`fieldPoint(toward)` and lerps by
  `progress`; `focus = frame.walking ?? frame.view.currentPlayer`.
- **Frames are requested while `busy`**: the gate is shut, a camera tween
  runs, or follow is easing toward the pawn. Once the gate opens and the
  camera settles, nothing draws. `invalidate()` is unchanged.
- `queue`, `running`, `walk`, `pause`, `skipToEnd` are gone, and so is
  `placeAll`. `scene.placePawn` no longer sets `focus` (the frame decides it).
- **`pawn(player)` test hook** — the Board's last placement for that Player,
  in viewport CSS px, computed like `fieldCenter`. It records the _un-offset_
  point that went into `placePawn`, so on a settled Field it equals
  `fieldCenter(field)` exactly; use it to assert pawn placement without
  reading Pixi internals. Added to `TestHooks` in `apps/web/src/test-hooks.ts`
  and mirrored in `apps/e2e/tests/test-hooks.ts`.

## Background tab (`apps/e2e/tests/background-tab.spec.ts`)

Playwright cannot hide a tab, and the app never reads `document.hidden`, so
the spec fakes what a hidden tab does to the Board instead: `page.evaluate`
replaces `window.requestAnimationFrame` with a park (callbacks are kept, real
ids returned) and restores it via `window.resumeBoardFrames`. Timers keep
running, so the Playback store's wakes still fire; the Playback runs out while
no frame can draw. One frame after the resume, `pawn(player)` equals
`fieldCenter(the walked Field)` — that is the whole hidden-tab rule, and the
test is red on the old queue (the pawn is at the walk's start).

## `tapField` (`apps/e2e/tests/helpers.ts`)

The two-frame `requestAnimationFrame` wait after `playback().gateOpen` is gone. It
existed because the old queue drew its last hop one frame after the gate; the
Board now seeks on every frame and a tap hit-tests the camera's Field
geometry, not the drawn pawn. `full-game`, `sale-tray`, `pick-tray` and
`two-guests` passed `--repeat-each 6 --retries 0` without it. If a tap ever
misses again, the cause is the layout-change miss (#26, handled by the helper's
retry), not the Playback.

## Docs and fences

- `board.ts`, `Board.tsx` and `playback/timeline.ts` doc comments describe one
  clock. `timeline.ts` stays: it is the core's (`playback/playback.ts`) only
  reader, and `playback.test.ts` still calls `timelineOf`/`stepAt`.
- `playback-fence.test.ts` still pins that `progress * event.steps` is
  interpolation, not a duration; the sample file it names is now
  `playback/playback.ts` (the core's `pawnsAt`), since the Board no longer
  scales step counts.
- Nothing outside `playback/` imports `timelineOf`/`stepAt` any more. The
  Board imports only the `Playback`/`Frame` types from `#playback/playback.ts`.
