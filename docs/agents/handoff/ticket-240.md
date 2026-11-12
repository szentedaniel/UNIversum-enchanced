# Ticket #240 (purchase and Rent cues): extension points and gotchas

Branch `agent/issue-240-sound-purchase-and-rent-cues`, spec #178. Builds on
#239's cue table and Playback-driven trigger; later sound tickets (Chance,
Bankrupt/game end, music) follow the same rows.

## The rows

- `CUES` gained `buy` and `rent` beside `dice`; each imports its file from
  `#assets/sounds/`.
- `EVENT_CUES`: `LevelBought`, `MuseumBought` and `BoughtOut` all map to
  `buy`; `RentPaid` maps to `rent`; every other row is unchanged (`"none"`).
- The three purchase events share one cue on purpose (spec #178 story 1–2). A
  Buyout's own intent emits only `BoughtOut`; a landing that pays Rent and then
  offers a Buyout emits `RentPaid` in the Roll's push and `BoughtOut` in the
  Buyout's own push, so the two cues mark two actions and never double-cue one
  (`packages/rules/src/rules/universities.ts`).

## Placeholder files

- `buy.mp3` and `rent.mp3` are byte copies of `dice.mp3`, because the owner's
  CC0 files are not in the repo yet. `apps/web/assets/sounds/LICENSES.md`
  marks both `Placeholder, replace`; the owner replaces the files and their
  rows together.
- Vite content-hashes and dedupes identical assets: today `dist/assets` holds
  one `buy-*.mp3` for all three cues. Real files separate them; do not rely on
  the built URLs to tell cues apart while the placeholders stand.
- Never author or generate audio; a new placeholder is another copy of an
  existing file and a new licence row.

## Tests that follow the table

- `apps/web/test/cues.test.ts` pins every row in `CUED`; adding a cue edits
  that literal and the `CUES` file-name assertions.
- `apps/web/test/sound.test.ts` iterates `Object.entries(CUES)`, so its unlock
  tests (`3 * Object.keys(CUES).length` elements, one silent play each) need no
  edit when a cue is added. The dice pool is the only one it plays before
  unlocking, hence the `name === "dice" ? [2, 2, 2] : [1, 1, 1]` expectation.
- `apps/web/test/cue-sync.test.ts` has the seeded `RentPaid` → `LevelBought`
  push: `rent` plays when `eventsReached` reaches 1, `buy` when it reaches 2.
  Later tickets add their own seeded push the same way.
