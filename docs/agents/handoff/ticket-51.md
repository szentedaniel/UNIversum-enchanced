# Ticket #51 (every screen plays the Playback in order) — extension points and gotchas

Branch `ticket/51-playback-timeline` (on `v2-modernization`). Completes ADR-0004
on the client: #50 built the shared durations, `actsAfter` and the server hold;
this ticket plays one push's events as an ordered, timed timeline on the Board
and in the status row, gates every control on both clocks, and waits out the
final Playback before the podium.

## Rules subpath for the client (`@universum/rules/playback`)

- The web may not import values from `@universum/rules` (the fence). The
  Playback durations are static rules data the client must use, so
  `packages/rules/package.json` now exports `./playback` (→
  `src/playback.ts`). `.oxlintrc.json`'s `no-restricted-imports` pattern and
  `apps/web/test/import-fence.test.ts` allow exactly that subpath; a value
  import from the root stays blocked (the fence test pins both). Web code
  imports `PLAYBACK_MS` / `playbackOf` from `@universum/rules/playback` and
  types from `@universum/rules`. Do not add a second duration table.

## Timeline (`apps/web/src/playback/timeline.ts`)

- `timelineOf(events)` → `PlaybackStep[]`: `{ event, startMs, durationMs, kind }`.
  `startMs` is the offset from the push's arrival; `durationMs` is
  `PLAYBACK_MS[type]` (`Moved` × `steps`). The step durations always sum to
  `playbackOf(events)` — the Playback the server waited for (unit-tested).
- `kind`: `"dice"` (`DiceRolled`), `"card"` (`CardDrawn`), `"none"` (`Moved`,
  and every zero-length event: `TurnPassed`, `OfferDeclined`), else `"toast"`.
  **#52** renders the dice and the Chance card from `"dice"`/`"card"` steps.
  The DOM needs step-scoped timing (dice for *its* step, not the whole walk):
  derive the current step from `timelineOf(push.events)` plus
  `Date.now() - push.receivedAt`, or extend the step clock; `usePlaybackToast`
  below is text-scoped (it keeps the last text up through text-less steps).
- `playback/toast.ts`: `toastCues(steps, textOf)` = the steps that have text,
  in order, with their absolute offsets; `cueAt(cues, elapsedMs)` = the last
  cue that has started. Unit tests: `apps/web/test/timeline.test.ts`.

## The decision gate (one store for the whole screen)

- `Push.receivedAt` (`stores/room-store.ts`) is this client's clock when the
  push arrived. `connection.ts` and `test-hooks.ts`'s `showView` set it; any
  new push writer must too, or the local Playback has no start.
- `playback/playback-store.ts`:
  `decisionOpensAt(push)` = `max(receivedAt + playbackOf(events),
  actsAfter - clockOffset)` — both clocks, on this client's clock. With no
  events (first view, reconnect, reload) only `actsAfter` applies.
  `playbackStore` is `{ seq, over }`; it subscribes to `roomStore.push` at
  module load, publishes synchronously, and schedules **one** wake-up at the
  opening (+20 ms). It reads timestamps, never animation frames, so a hidden
  tab cannot open the gate early or wedge it. `apps/web/test/playback-gate.test.ts`
  covers the arithmetic.
- `Game.tsx` reads `useStore(playbackStore, (s) => s.over)` as `playbackOver`
  and gates every control, the Sale/pick trays, the "other Player is choosing"
  lines and the podium (`gameOver && playbackOver`) on it. Do not re-add a
  local timer.
- `Board.tsx`'s `currentSale`/`currentPick`/`syncPick` read the store and the
  Board subscribes to `over`; the old `playbackTimer` (actsAfter only) is gone.
- E2E: `window.universumTest.playback()` returns `{ seq, over }`.
  `two-guests.spec.ts`'s frame probe records `open` and asserts no decision
  control is visible while the gate is shut.

## Board (`apps/web/src/board/board.ts`)

- `STEP_MS`/`DICE_MS` are gone. `update()` queues one animation per timeline
  step: `Moved` walks over `step.durationMs`, every other step is
  `pause(step.durationMs)`, so the queue runs exactly as long as the Playback.
  `animationFor` no longer exists; a new animated step type is a `case` in the
  queue loop (or a new step kind from the timeline).
- A newer push still calls `skipToEnd()` first: the running Playback jumps to
  its end and the new one starts, Board and toast together.

## Toast (`screens/Game.tsx` + `playback/use-toast.ts`)

- `usePlaybackToast(push)` returns the current `ToastCue` (`{ startMs, event,
  text }`). It starts with a 0 ms timer (the effect body stays pure), then one
  timer per cue, all computed from `push.receivedAt`; a late timer jumps to the
  latest cue reached, and a new push blanks the old text at once.
- `eventText(event, view)` moved from `Game.tsx` to `text.ts` (same switch,
  id/number-only events to hu/en/de text). Any new event needs a case there
  and a message key in all three languages.
- `NOTICES` is now a `Partial<Record<GameEvent["type"], true>>` that only picks
  the toast's tone (accent `good` vs neutral); it no longer chooses which event
  is shown. A Rejection's text still wins while its `seq` is newer than the push.
- Zero-length events are `kind: "none"` and get no toast (`OfferDeclined`s text
  never shows now); events with no text (`Moved`, `DoublerPlaced`) leave the
  previous text up.

## Gotchas

- The gate store subscribes to `roomStore` at import; both `Game.tsx` and
  `Board.tsx` import it, so it is live before the first push. Importing it in a
  Node unit test is fine (timers are the globals, not `window`).
- `showView` pushes `events: []` and `receivedAt: now`. A made-up view *with*
  events would now delay its podium/controls by the local Playback; specs that
  need an immediate surface must keep `events` empty and `actsAfter` past.
- The full 4-Guest Playwright game now takes ~2.1 min (each Turn waits out its
  Playback inside the 240 s guard).
- The spec #22 "Modules" line ("only types and the static Board data") is
  extended in practice by the `playback` subpath; keep the fence and the spec's
  wording in mind when touching either.
