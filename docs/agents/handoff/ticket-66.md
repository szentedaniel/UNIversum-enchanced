# Ticket #66 (the Playback core and its store): extension points and gotchas

Branch `ticket/66-playback-core` (on `v2-modernization`), spec #63. One pure
core answers "what does this screen show at client time t?" for a push, and one
store owns the only Playback timer. The DOM hooks from #51/#52 are gone; #67
makes the Board read the same frames.

## The core (`apps/web/src/playback/playback.ts`)

- **`playbackOfPush(push, previousTurn = null)`** → `{ opensAt, boundaries,
  frameAt(clientNow) }`. `push` is `PlaybackPush` (the fields of
  `roomStore.push` the Playback reads); `previousTurn` is the `TurnLabel` the
  screen shows now, which the store passes so a held Turn survives the next
  push.
- **`opensAt`** = `max(receivedAt + playbackOf(events), actsAfter - clockOffset)`,
  on this client's clock. This file holds the fence's one inverse conversion
  (`actsAfter - clockOffset`); `playback-fence.test.ts` names it by file and
  line, so moving the expression means updating the fence.
- **`boundaries`** = every step end (`receivedAt + startMs + durationMs`) plus
  `opensAt`, sorted and deduped. The store schedules one timer at the first
  boundary after now.
- **`frameAt(clientNow)`** returns `Frame`:
  - `seq`, `view` (`push.view` for now; a later per-event reveal changes only
    this field).
  - `overlay`: the current `dice`/`card` step (the step object, so `startMs`
    stays the Chance card's close key and `event` is narrowed), else `null`.
    It is built by `stepAt`, so it never outlives its step.
  - `toast`: the latest started cue `{ event, text, tone }` from
    `presentation.ts` (`eventText` + `toneOf`), else `null`. The last line
    stays up after the Playback ends.
  - `gateOpen`: `clientNow >= opensAt`.
  - `shownTurn`: the previous label until the gate opens, unless there is no
    previous label or the push has no events (first view, reconnect, reload) —
    the old `turnLabelToShow` rule, now inside the core.
  - `pawns`: `ReadonlyMap<PlayerId, PawnPosition>`, `{ field, toward, progress }`.
    Before a Player's first `Moved` step: its `from`. During a step: hop by hop,
    `field` = the hop's start, `toward` = its end, `progress` 0–1; Field numbers
    wrap with `FIELD_COUNT` (it never uses `to` for the current hop, so a walk
    across Start is `31 → 0`). Between steps: the last `to`. After the Playback:
    `view.players[].position`. A Player with no `Moved` never leaves the view.
  - `walking`: the Player whose step is active, else `null`. The Board's camera
    follows it.

Everything is plain data except the pawn map; the tests call `frameAt` with
plain numbers (`apps/web/test/playback.test.ts`, fixtures shared with the store
test in `apps/web/test/playback-fixtures.ts`).

## The store (`apps/web/src/playback/playback-store.ts`)

- State is `{ frame: Frame | null, opensAt: number | null }`; both are `null`
  before the first push.
- It subscribes to `roomStore.push` at import. A new push builds the core once
  (`playbackOfPush` with the previous frame's `shownTurn`), publishes the frame
  synchronously and schedules one `setTimeout` at `next boundary + 20 ms`; a
  timer wake only calls `current.frameAt(Date.now())` on that same core and
  arms the next boundary. A new push clears the timer and replaces both; a push
  with no events has one boundary, `opensAt`.
- **`gateOpenOf(state)`** is the one gate selector (`frame?.gateOpen ?? true`):
  `Game`, both `Board` reads, the Board subscription and the `playback()` hook
  use it. There is no frame before the first push, which means nothing to wait
  for, so the gate is open.
- **`currentPlayback()`** returns the latest push's core (or `null`). It is the
  same object for the whole life of a push, so #67's Board render loop may hold
  it and call `frameAt(Date.now())` per animation frame — `Date.now()`, not the
  frame timestamp, so the Board and the DOM read one clock. Do not add a second
  timer: animation frames are for drawing and the camera tween only.
- **`PlaybackGate`** / `playback()` test hook: `{ seq, over, shownTurn }`, with
  `over = frame.gateOpen` and `seq`/`shownTurn` from the frame. The e2e
  `PlaybackHook` mirror needs no change.
- `Game.tsx` reads `gateOpen`, `shownTurn`, `toast` (including its `tone`) and
  `overlay` with `useStore` selectors; `Board.tsx`'s `currentSale` /
  `currentPick` read `gateOpen` and the Board subscribes to it. The Chance
  card's React key is still `${push.seq}:${overlay.startMs}`. Nothing outside
  `playback/` calls `timelineOf`/`stepAt` except `board/board.ts`.

## Deleted

`use-playhead.ts`, `use-step.ts`, `use-toast.ts`, `toast.ts`, `turn-hold.ts`,
the `timeline`, `playback-gate` and `turn-hold` vites, and e2e
`turn-hold.spec.ts`. `timeline.ts` stays because the Board's queue still reads
it until #67.

## Story 4 / no-visible-change notes

- The frame's `shownTurn` is the held label; `Game.tsx` still renders the Turn
  card from it while the ring and the current Player read `push.view`.
- The Board's queue is untouched in this ticket, so the last hop still lands
  on the animation frame after the gate: `tapField`'s two-frame wait stays
  until #67 seeks the Board. The five specs that touch the Playback
  (`two-guests`, `chance-card`, `sale-tray`, `pick-tray`, `podium`) passed
  `--repeat-each 6 --retries 0`.
- Store vitest uses fake timers and proves the frame changes at each boundary
  and at `opensAt`, a new push replaces the frame and timer, and a push with
  no events opens at `actsAfter`.

## For #67

- Delete `queue`, `running`, `walk`, `pause`, `skipToEnd` from `board.ts`;
  on each animation frame while the Playback runs, read
  `currentPlayback()?.frameAt(Date.now())` and place each pawn from
  `frame.pawns` (`field`/`toward`/`progress` → `fieldPoint`/`lerpPoint`),
  following `frame.walking` else the current Player. `invalidate()` keeps
  requesting frames until `frame.gateOpen`.
- Then drop `timelineOf`/`stepAt` from `board.ts` (the core owns them) and the
  `tapField` two-frame wait, if repeated runs stay clean.
