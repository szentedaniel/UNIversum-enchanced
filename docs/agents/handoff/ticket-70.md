# Ticket #70 (review fixes for spec #63): what changed and what to watch

Branch `ticket/70-review-fixes-63` (on `v2-modernization`), spec #63. Review
fixes only: no timing, no visible string and no rule changed. This note
supersedes the shapes #65–#68 describe where they disagree.

## The gate's name (was `over`)

- The test hook `playback()` is `{ seq, gateOpen, shownTurn }`. `gateOpen`
  matches `Frame.gateOpen` and the glossary's **Decision gate**; `over` was
  the glossary's _Avoid_ word. Changed together: `PlaybackGate`
  (`playback-store.ts`), the web hook (`test-hooks.ts`), the e2e mirror
  `PlaybackHook` (`apps/e2e/tests/test-hooks.ts`), `helpers.ts`'s `tapField`
  poll (its prose now says "the Decision gate must be open first"),
  `background-tab.spec.ts`, `two-guests.spec.ts`'s probe (`open:` now reads
  `gateOpen`) and `failure-dump.spec.ts`'s exact-shape expectation. The dump
  test is what pins the field name at runtime; the type mirror is what pins
  it for specs.
- `CODING_STANDARDS.md` §Docs already forbids the avoided word; the hook now
  follows its own rule. The stale lines in `ticket-66.md` (the store's state and
  the hook's shape) and the `INDEX.md` ticket-66 line were corrected in place,
  each with a "(since #70)" note.

## `Frame.view` is the only view a screen reads (#69 builds on this)

- `Game.tsx` reads the view with a `playbackStore` selector
  (`state.frame?.view ?? null`) and guards `!push || view === null`. The store
  publishes the frame synchronously inside the `roomStore.push` subscription,
  which runs before React's subscribers, so the guard is never reached in
  practice; `push` stays the source for `seq`, `clockOffset` and `events`.
- `Board.tsx`: `openView()` returns `frame.view` while the gate is open and
  `null` otherwise; `currentSale()`, `currentPick()` and `syncPick()` all go
  through it. `syncPick()` computes the Sale and the pick (both null while the
  gate is shut) and runs its decision-change reset **before** it returns, so a
  push that starts a Playback closes the open Field card and leaves inspect
  mode at once, as it always did — an early `view === null` return there
  defers that reset to the gate's opening. `push` is read only for
  `clockOffset`, and a missing push returns early (no Lobby fallback).
  `gateOpenOf` is still the selector for `Game` and the Board's
  `playbackStore.subscribe(gateOpenOf, …)`.
- `board.ts`: `update(playback)` now only stores the core and calls
  `invalidate()`. The render loop's `frame()` compares `at.view !== shown`
  (object identity) and, on a different object, syncs pawn visibility and the
  Fields (owner rings, Levels, Doubler, notes) and re-fits on a Turn change;
  then it places the pawns from `at.pawns`. **A later per-event reveal (#69)
  must hand a new `view` object whenever anything in it changes** — the
  identity check is the only redraw trigger, and there is no per-frame work
  beyond that comparison. The `view()` test hook (Board's `shown`) now reports
  the last drawn frame's view, not the view handed to `update`, so a spec that
  reads it right after a push must poll (the existing specs do).
- `Board`'s `update` doc, `view` hook doc and the module comments describe one
  clock; `CODING_STANDARDS.md` §Web now says a screen reads `frame.view`,
  never `push.view`, and names the presentation table.

## Presentation table

- `DoublerPlaced` is `overlay: "none"` (it was a textless `toast`). The
  previous toast line stays up through its 600 ms step, which is what the
  screen did before; the Board shows the Doubler itself.
- `presentation.test.ts` gains two pins over every event type: a `toast` row
  has a `text`, and an event whose `PLAYBACK_MS` is `0` has `overlay: "none"`
  (the test derives the zero-length set from the rules, it does not copy it).
  Reverting `DoublerPlaced` to a textless toast fails both.
- `presentationOf` is no longer exported; `toneOf`, `eventText` and
  `withOverlay` are the module's surface. The test builds its view from
  `playback-fixtures.ts` (`viewOf()`), not a local copy.

## Store

- `PlaybackState` is `{ frame }`: `opensAt` is gone (nothing read it). A test
  that needs it uses `currentPlayback()?.opensAt`.
- `playback-store.test.ts` walks the core's `boundaries`: 1 ms before each one
  the frame object is the same (`toBe`), 20 ms after it is a new one. Arming
  the timer at `next - 50` instead of `next + 20` fails that test and the
  gate test — the mutation was run and reverted.

## E2E

- `background-tab.spec.ts` budgets its gate poll with
  `playbackOfEvent({ type: "Moved", … steps: WALK_STEPS })` plus a second of
  slack (`POLL_SLACK_MS`, because the store wakes ~20 ms past the boundary and
  Playwright's poll ladder can leave a second between checks), over the `Moved`
  the spec itself pushes (no bare `5_000`). `starveFrames` parks callbacks and
  returns one plain id (`1`): nothing cancels a parked frame.
- `tapField` still waits for the gate (the dice and the Chance card cover the
  Board); its timeout stays `PLAYBACK_MS.CardDrawn`.
- `sale-tray.spec.ts` pins the Board's reset order: with a Field card open in a
  Sale's inspect mode, a made-up push whose Chance card shuts the gate closes
  the card within a quarter of `PLAYBACK_MS.CardDrawn`, while the gate is still
  shut.
- `helpers.ts` has the one `showChance(page, card, effects?)` step (#70 round
  3): it clones the latest push's view, opens the decision at once on the
  server's clock and pushes a `CardDrawn` plus the card's money effects, whose
  `player` it fills in. `chance-card.spec.ts` and `sale-tray.spec.ts` both call
  it; do not copy it back into a spec.

## Test names

The `ADR-0004:` prefix stays only on the tests that pin an ADR-0004 claim —
the durations, the gate and the server clock. In `playback-store.test.ts` that
is the boundary timing ("reads the frame at each boundary and never a moment
early"), "a push with no events has one boundary, its actsAfter" and "the gate
opens at the server's `actsAfter` when it is later". The other store tests
("holds one core for the whole life of a push", "a new push replaces the
previous frame and its timer", the frame's contents at each boundary) and the
presentation-table tests carry no prefix and are named by behaviour.
