# Ticket #242 (Bankrupt and game-end cues): extension points and gotchas

Branch `agent/issue-242-sound-bankrupt-and-game-end-cues`, spec #178. Builds
on #239's cue table and Playback-driven trigger and the rows #240/#241 added;
only the music ticket remains.

## The rows

- `CUES` gained `bankrupt` and `gameEnd` beside the six earlier cues; each
  imports its file from `#assets/sounds/`.
- `EVENT_CUES`: `WentBankrupt` → `bankrupt`, `GameEnded` → `gameEnd`. A
  Timeout stays silent: `TimedOut`, `TimeoutPenaltyPaid`, the `FieldsSold` its
  Auto-sell emits and the `TurnPassed` beside them are all `"none"`.

## A Bankrupt that ends the game

A charge that bankrupts the last opponent emits `WentBankrupt` and `GameEnded`
in one push. `syncCues` reads the frame's `eventsReached`, so the two cues play
in that order at their own step starts — `bankrupt` when `WentBankrupt`'s step
begins, `gameEnd` when `GameEnded`'s does. They are different cues, so their
element pools never cut each other off (`apps/web/src/audio.ts`).

## The game end and the podium

`GameEnded` has `PLAYBACK_MS.GameEnded = BEAT_MS` (600 ms) today, but the cue
does not depend on that: the cursor counts the event once its step starts, and
a zero-length last step is counted when the frame's `eventsReached` jumps to
the push's event count. `bottomSlot` returns the podium only once
`frame.gateOpen`, which is never before the Playback ends, so `gameEnd` has
already played at the frame where the podium becomes the bottom slot, and no
later frame plays it again. Sound code never waits for the podium or does
timing arithmetic (ADR-0004).

## Placeholder files

- `bankrupt.mp3` and `game-end.mp3` are byte copies of `dice.mp3` (md5
  `c902feb245d694876a33f9a6a0c2a37a`), because the owner's CC0 files are not in
  the repo yet. `apps/web/assets/sounds/LICENSES.md` marks each
  `Placeholder, replace`; the owner replaces the file and its row together.
- With identical bytes Vite dedupes: a `TEST_HOOKS=1` web build writes a single
  hashed `dist/assets/*.mp3` for every cue. Do not use the built URL to tell
  cues apart while the placeholders stand; the vitest assertions read the
  source paths, which keep their own file names.
- Never author or generate audio; a new placeholder is another copy of an
  existing file and a new licence row.

## Tests that follow the table

- `apps/web/test/cues.test.ts` pins `WentBankrupt`/`GameEnded` in `CUED`,
  asserts `CUES.bankrupt` and `CUES.gameEnd` name their own files, covers the
  `TIMEOUT()` fixture as silence, and pins `[WentBankrupt, GameEnded]` as
  `["bankrupt", "gameEnd"]` by range.
- `apps/web/test/cue-sync.test.ts`'s `the game-end cues` describe drives
  `{ seq, eventsReached }` frames 0 → 1 → 2 for the order, then a real
  `playbackOfPush`: one frame at the Playback's end jumps 0 → 2 and plays
  `bankrupt` then `gameEnd` from that frame alone, while `gameEnd` plays at the
  `GameEnded` step's start and never on a later frame after the Playback ends.
  Both cue tests share the `BANKRUPT_END()` fixture in
  `playback-fixtures.ts`; the game-over view and `bottomSlot` are not involved.
- `apps/web/test/sound.test.ts` iterates `CUES`, so the two new cues need no
  edit there: it unlocks `3 * Object.keys(CUES).length` elements.
