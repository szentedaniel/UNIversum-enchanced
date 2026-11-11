# Ticket #182 (Event log): extension points and gotchas

Branch `agent/issue-182-event-log-panel` (from `main`); client-only, no spec
parent. The Game screen can open a panel listing the lines of the events the
Playback has revealed so far, newest last, in the active language. Read for:
any new event line, Playback step or Game status-row touch.

## Data flow

- **The pure module is `apps/web/src/playback/log.ts`:** `LogLine`
  (`{ seq, index, text }`), `LogState` (`{ lines, cursor }`), `emptyLog`,
  `LOG_LIMIT = 200` and `appendRevealed(log, push, revealed)`. It reads each
  event's line through `eventText(event, push.view)` from the presentation
  table, so there is no second event-to-text table; an event whose `text` is
  absent appends nothing.
- **The store is `apps/web/src/stores/log-store.ts`:** `logStore`, `syncLog`,
  `resetLog`. It holds only the lines and the cursor; the panel subscribes to
  it.
- **The gate is `Frame.revealed`** (`apps/web/src/playback/playback.ts`): how
  many of the push's events the Playback has reached (the timeline's
  `lastStarted` index plus one, and all of them once the Playback ends).
  `playback-store.ts`'s `publish` calls `syncLog(push, frame)` after every
  published frame (the push's arrival and every boundary), so a line appears at
  its own step's start and never ahead of the Board.
- **Dedupe is the cursor:** `appendRevealed` appends only events past the
  cursor for that push; a repeated read of the same push returns the same state
  object, and a frame for a push the log has already passed adds nothing. A new
  push starts its cursor at 0 and keeps the earlier lines.
- **The cap lives in `LOG_LIMIT`** in `playback/log.ts`: the newest lines are
  kept, the oldest dropped.
- **Reset:** `room-store.ts`'s `reset()` calls `resetLog()`, and
  `connection.ts`'s `leaveRoom` (also reached by `attach` before a new join)
  calls `reset()`. The log is memory only: a reload, a reconnect or a Room
  change starts empty, and nothing fetches the server's stored events.

## Gotchas

- **Text is fixed at append time.** `eventText` is called with the push's own
  view, and the resulting string is stored; never re-render a line against the
  latest view, whose Players may have changed. The active language at append
  time is the line's language (a language switch reloads the page, so the log
  restarts anyway).
- **A push with no events adds no line** (its frame has `revealed: 0`), and a
  reconnect push has no events.
- **No import cycle:** `room-store` → `log-store` → `playback/log`; the
  Playback store also imports `log-store`, and `log-store` imports neither
  store. `syncLog` takes the push as an argument for this reason.
- **The Playback store wakes a few ms past a boundary** (`+ 20`), so a fake-timer
  test advances to `boundary + 20`, as `apps/web/test/event-log.test.ts` does.
  The pure cases (append, skip, dedupe, cap, reset) are in the same file.

## UI

- `apps/web/src/components/EventLog.tsx` is a `Dialog` (the `GameMenu` shape)
  mounted in `Game.tsx`'s `statusRow` beside the menu, so it never covers the
  Board. The trigger is a labelled icon button (`data-testid="event-log"`);
  the scrolling list is `role="log"` with `aria-relevant="additions"`
  (`data-testid="event-log-lines"`), and the empty state is a message.
- Messages are `log_title`, `log_toggle` and `log_empty` at the end of
  `apps/web/messages/{en,hu,de}.json`; `messages.test.ts` guards parity.

## Adding a line type

Give the event type its `text` row in `EVENT_PRESENTATION` (the existing
compile-time requirement). The log picks it up automatically at the event's
Playback step. An event with `overlay: "none"` and a text would need a
deliberate decision: the current rule appends every event whose `eventText` is
non-null, regardless of its overlay, so gate it inside `appendRevealed` if it
must not appear.
