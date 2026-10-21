# Ticket #52 (the Roll's dice and the Chance card in the Playback) — extension points and gotchas

Branch `ticket/52-roll-and-chance-card` (on `v2-modernization`). The last
ticket of spec #49: the local Playback from #51 now has a DOM layer for the two
steps that need more than the toast — the Roll's dice and a drawn Chance card.
Both are timed from `Push.receivedAt`, and each shows for its own step only.

## Step timing (`playback/timeline.ts`, `playback/use-playhead.ts`, `playback/use-step.ts`)

- `stepAt(steps, elapsedMs)` → the step covering that instant, `null` before it
  starts or once the Playback has ended; a zero-length step is never current.
  Unit-tested in `test/timeline.test.ts` ("the Playback playhead").
- `usePlayhead(push)` → `{ seq, elapsedMs }`, re-read at every positive step's
  end from timers (never animation frames), so a background tab catches up
  instead of replaying what it missed.
- `usePlaybackStep(push)` → the step under the playhead. `Game.tsx` renders the
  dice for `DiceRolled` and the card for `CardDrawn`, nothing else. A new DOM
  overlay is a `case` in that render plus a component; it must not keep a timer
  of its own.
- `use-toast.ts` now reads `usePlayhead` instead of timing its cues itself;
  the toast's cue instants are step boundaries, so the two stay in step.

## DOM overlays

- `components/DiceOverlay.tsx`: two CSS-pip dice (3 × 3 grid, `bg-card`/`bg-ink`,
  `sticker`), `data-testid="dice"`, `aria-label` from `dice_rolled`. `pop-in` is
  the only motion; the global reduced-motion rule shortens it.
- `components/ChanceCardOverlay.tsx`: `chanceCardText(card)` for the title and
  text, `data-testid="chance-card"`. Close (`chance_card_close`) is component
  state: it hides the card on this screen only and never touches the gate, the
  timeline or `actsAfter`. `Game.tsx` keys it by `push.seq:step.startMs`, so a
  new card starts open and a newer push drops the old one.
- `styles.css` `.playback-overlay`: absolute in the Board's box, using the same
  `--board-inset-*` variables as `.board-fit-area`, so it clears the camera
  buttons and the bottom card/tray. `pointer-events: none`; only the card is
  `pointer-events: auto`. There is no exit animation, so nothing lingers over
  the taps that appear when the Playback ends.
- `Game.tsx` places it inside the Board wrapper in both layouts; the phone
  layout adds `landscape:bottom-24` (a landscape phone reserves no bottom inset
  for its compact bottom card).

## Messages

- `dice_rolled` (`{first}`, `{second}`) and `chance_card_close` in hu/en/de.
  `apps/web/test/messages.test.ts` covers their presence and placeholders.

## Tests and test hooks

- `apps/web/test/timeline.test.ts`: the Chance charge followed by its forced
  Sale, and `stepAt` (dice step-scoped, card for its 7 s, zero-length never
  current, nothing after the Playback).
- `window.universumTest.showView(view, events?)` now takes the push's events
  (default `[]`), so a spec can show a made-up Playback. Those events also hold
  the decision gate for `playbackOf(events)`; set `actsAfter` as the specs do
  if a later control must appear sooner.
- `two-guests.spec.ts`'s frame probe records `dice` (inside the viewport) and
  asserts both screens saw it during the first Roll's hold.
- `chance-card.spec.ts` shows a made-up `CardDrawn` push on both screens,
  closes it on one, and asserts the other still shows it.

## Gotchas

- `data-testid="dice"` exists for the dice step only (450 ms). A probe that
  starts after the Roll push has played out will find nothing.
- The overlay is deliberately not a `[data-board-obstacle]`: the Field-card
  reveal should keep the whole Board fit area, not shrink it for a 450 ms or
  7 s overlay.
- The Chance card appears for `CardDrawn` only; the PCR card's effect has no
  follow-up event (by design, #28), so its Playback ends with the card.
