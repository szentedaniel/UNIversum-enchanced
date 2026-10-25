# Ticket #84 (review fixes for #80–#82): what changed and what to watch

Branch `ticket/84-review-fixes` (on `per-event-reveals`), spec #79. Review
fixes only: no rule, event, protocol field, `STATE_VERSION` or visible string
changed.

## Story 25: the Board redraws only on a change

- `apps/web/src/playback/playback.ts` builds each step's merged view in
  `viewsOfSteps`, once per push, and compares what two steps _show_:
  `sameBoard(previous, reveal)` over the Players (every `PlayerView` field
  except `position`, which the pawn walk plays and `viewOfStep` takes from the
  final view), the Fields (owner, Level, Value, Rent, Sale) and the Doubler. An
  unchanged board hands out the previous step's **merged view object** again,
  so `board.ts`'s `at.view !== shown` check skips the whole Field/pawn re-sync.
  A changed board — or the first step with a reveal — gets a new object.
- **Do not compare the raw reveals.** The first cut keyed on
  `JSON.stringify(reveal)`, which is wrong on a real push: the `DiceRolled`
  reveal is the board _before_ the move and the `Moved` reveal the one after,
  so their `position`s differ and the walk would still have redrawn, although
  both merged views are identical. `playback.test.ts`'s `ADR-0005: a reveal
  that only moved a pawn keeps the previous step's view object` builds a real
  Roll from `setupGame`/`apply` and fails under the JSON key.
- A step **without** a reveal shows `push.view` and clears the comparison, so
  a later reveal is never compared with an older one across the gap.
- The comparison is in `playbackOfPush`, never in `frameAt`: `frameAt` only
  indexes the array it was handed. `viewsOfSteps` takes the steps array (its
  length is the step count) and `viewOfStep` takes a `Reveal`, never
  `undefined`.
- The Playback's end still switches to `push.view` itself, unchanged.

## The cue rule vs `stepAt` (the zero-length gotcha)

`frame.view` and the toast both follow `lastStarted` — the latest event that
has started, zero-length steps included, the last of several at the same
millisecond. `timeline.ts`'s `stepAt` skips zero-length steps and reports
`null` between them.

For `frame.view` the two rules are **observationally identical**: a step can
only be the latest started at `t < playbackOf(events)` if its own duration is
positive (every later step starts at or after its start), and the only
zero-length step `lastStarted` can pick is the last one, at a `t` where the
end guard already hands out `push.view`. Do not try to write a view test that
tells them apart — there is none; the ticket's example (a zero-length step's
reveal showing at the exact ms it starts) cannot happen by construction.

The difference is observable in the **toast**: `cueAt` keeps the last line up
after the Playback ends, while a `stepAt`-based cue drops it.
`playback.test.ts`'s zero-length test pins that (and the shared-start
tie-break, and the end guard): it fails if the cue is chosen by `stepAt`, or if
the `elapsedMs >= playbackEndMs` guard is dropped.

## Rules tests

- `reveals.test.ts` gains `R61, ADR-0005:`: placing the Doubler on Vienna
  doubles the Rent, the reveal before the placement still shows the old Rent
  and no Doubler, and the `DoublerPlaced` reveal's `rent`, `value`, `doubler`
  and both Players' Wealth equal `publicView` of the same state. It fails if
  `doubler.ts` emits before applying the token (mutation run and reverted).
- `revealOf` is **no longer exported** from `@universum/rules`: only `tx.ts`
  and `view.ts` inside the package use it. `Reveal`, `PlayerView` and
  `FieldView` stay exported (the web and e2e use `Reveal`).

## Server

`GameRoom.commit(applied, intent = "Start")` takes the engine's `Applied`
directly; the old `Pick<Applied, "state" | "events" | "reveals">` listed every
field of the type. `startGame` still passes `{ state, events: [], reveals: [] }`.

## E2E

`apps/e2e/tests/reveals.spec.ts` names its toast-wait slack `TOAST_SLACK_MS`
(5 s beyond `WALK_MS`, deliberately not `background-tab.spec.ts`'s 1 s
`POLL_SLACK_MS`: that one polls a flag, this one waits for a re-rendered toast
and two Player cards) and reads the payer/owner ids and their Seats in one
`page.evaluate` instead of two.
