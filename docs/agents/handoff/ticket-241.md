# Ticket #241 (Chance card and Quarantine cues): extension points and gotchas

Branch `agent/issue-241-sound-chance-card-and-quarantine-cues`, spec #178.
Builds on #239's cue table and Playback-driven trigger and #240's rows; the
remaining sound tickets (Bankrupt/game end, music) add rows the same way.

## The rows

- `CUES` gained `chance`, `quarantine` and `release` beside `dice`/`buy`/`rent`;
  each imports its file from `#assets/sounds/`.
- `EVENT_CUES`: `CardDrawn` → `chance`, `QuarantineEntered` → `quarantine`,
  `QuarantineReleased` → `release`. The Chance card's money follow-ups
  (`ChanceMoneyReceived`, `ChanceChargePaid`, `ChanceTransferPaid`),
  `QuarantineRoundUsed`, `PcrTestBought` and `PcrTestUsed` stay `"none"`; a
  cue belongs to the event that shows the card or the notice, not to the money
  change it causes.
- A Chance card that sends the Player to Quarantine (`examPeriod`) emits `CardDrawn`,
  then `Moved`, then `QuarantineEntered` in one push. The frame reaches the two
  cue events at two step starts, so `chance` then `quarantine` play in order —
  they are different cues, so the per-cue element pools never cut each other
  off (`apps/web/src/audio.ts`).

## Chance card timing

`CardDrawn` is the only `card` overlay (`apps/web/src/playback/presentation.ts`);
its step starts after the dice and the walk, so the cue plays when the overlay
opens, not on the push. `eventsReached` counts the Chance card event once its step has
started, so `syncCues` needs no special case: the frame that first shows
`overlay.kind === "card"` is the frame that plays `chance`. The Chance card's step is
`PLAYBACK_MS.CardDrawn` (7 s); never time the cue from a second constant
(ADR-0004).

## Placeholder files

- `chance.mp3`, `quarantine.mp3` and `release.mp3` are byte copies of
  `dice.mp3` (same md5), because the owner's CC0 files are not in the repo yet.
  `apps/web/assets/sounds/LICENSES.md` marks each `Placeholder, replace`; the
  owner replaces the file and its row together.
- With identical bytes Vite dedupes: a `TEST_HOOKS=1` web build writes a single
  hashed `dist/assets/*.mp3` for every cue. Do not use the built URL to tell cues
  apart while the placeholders stand; the vitest assertions read the source
  paths, which keep their own file names.
- Never author or generate audio; a new placeholder is another copy of an
  existing file and a new licence row.

## Tests that follow the table

- `apps/web/test/cues.test.ts` pins every row in `CUED` and adds
  `CUES.chance`/`quarantine`/`release`'s file names (`quarantine` and
  `release` differ). Its `cuesReached` cases cover the real `CHANCE()` push
  (dice then chance, the money follow-up silent) and a Quarantine sequence
  (entered, round used, PCR bought and used, released → `quarantine`,
  `release`).
- `apps/web/test/cue-sync.test.ts` imports `timelineOf` to find the Chance card step's
  `startMs` from the real `CHANCE()` push, then reads
  `playbackOfPush(...).frameAt(receivedAt + startMs)`: the frame before it plays
  only the dice, that frame has `overlay.kind === "card"` and plays `chance`
  once. A second case runs `CardDrawn` + `Moved` + `QuarantineEntered` to pin
  `["chance", "quarantine"]` from one frame.
- `apps/web/test/sound.test.ts` iterates `CUES`, so the three new cues need no
  edit there: it unlocks `3 * Object.keys(CUES).length` elements.
