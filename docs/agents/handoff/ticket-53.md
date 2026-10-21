# Ticket #53 (Playback review fixes) — what changed and gotchas

Branch `ticket/53-playback-review-fixes` (on `v2-modernization`). Review fixes
for spec #49. Items 1–7 are behaviour-preserving refactors; only story 4
changes what a screen shows (the turn card's heading and Turn number wait for
the decision gate).

## Rules

- `packages/rules/src/playback.ts` exports **`playbackOfEvent(event)`**: one
  event's Playback length, `Moved` scaled by its `steps`. `playbackOf(events)`
  is now the sum of it. Both are exported from the root and from
  `@universum/rules/playback`.
- The web's timeline uses `playbackOfEvent`; no client code multiplies
  `steps * PLAYBACK_MS.Moved` itself. A new duration is still one
  `PLAYBACK_MS` entry, and `playbackOfEvent` is the only scaling formula.

## Web

- `playback/timeline.ts`: `PlaybackStep` is a discriminated union on `kind`
  (`dice` / `card` / `toast` / `none`) that fixes the event type
  (`dice` → `DiceRolled`, `card` → `CardDrawn`). `Game.tsx` switches on
  `step.kind`; a new DOM overlay is a new kind plus a `case`, never an
  `event.type` check. `StepKind` is still exported, and `kind` lives on
  `TimedStep`.
- `playback/playback-store.ts`: the gate state now carries
  `shownTurn: { turn, currentPlayer }`. `sync` switches it together with
  `over`: while a push with events is playing it keeps the label shown at the
  last open gate; a push with no events (first view, reconnect, reload) shows
  the current label at once. `Game.tsx` renders the turn card from
  `shownTurn`; the ring and the current Player's card highlight still read the
  push's `view`, so they move at once as before.
- `playback/turn-hold.ts`: the pure rule `turnLabelToShow(shown, current, over,
  hasPlayback)`; unit test `test/turn-hold.test.ts`. The store calls it, the
  Game only reads the result — do not add a second timer or a ref-held label.
- `lib/server-clock.ts`: **`serverNow(clockOffset, clientNow = Date.now())`**
  is the one server-clock estimate. `TurnRing`, `MinutePill`, the Board's Sale
  marks and the Lobby's held-Seat countdown use it. `decisionOpensAt` keeps its
  inverse (`actsAfter - clockOffset`), which is not the same operation.
- `board/Board.tsx`: `currentSale`/`currentPick` hold the only decision-gate
  check; `syncPick` no longer repeats it. `onFieldTap` gets the same hold for
  free, because it goes through those two functions.
- `apps/web/test/import-fence.test.ts`: the allowed sample includes
  `playbackOfEvent`; the forbidden root import stays pinned.

## E2E

- `tests/helpers.ts` is the one shared module for the multi-Guest specs:
  - `startGame(page, browser)` creates a 2-Player Room, joins a Guest and waits
    for both Boards' test hooks (`chance-card`, `turn-hold`).
  - `press(actor, locator)` waits for `toBeEnabled` (15 s), then taps or clicks.
  - `ownFields(view, player)`.
  - `tapField(actor, field)` waits for `playback().over` (bounded by
    `PLAYBACK_MS.CardDrawn`), waits two animation frames, taps through
    `fieldCenter` and retries a missed tap.
  - `resolveDecision(actor, view, chooseOffer)` resolves an offer (the spec's
    policy picks the choice), a Doubler/Erasmus pick or a Sale, and returns
    `{ kind: "buy", choice, field, owner } | { kind: "decline" } |
    { kind: "pick" } | null`. An `Interactor` is `{ page, mobile }`.
- `two-guests.spec.ts` keeps its own assertions and policy (first University,
  first Museum, then Decline; the waiter must not see the offer).
  `full-game.spec.ts` takes the first Level or Museum and never a Buyout.
- `ROLL_PLAYBACK_MS` and `FINAL_PLAYBACK_MS` are `playbackOf([…])` over
  representative event lists (the same worst case: dice + 12-Field walk + a
  CardDrawn + its effect; the final one adds `GameEnded`). Do not hand-sum
  `PLAYBACK_MS` entries again.
- `turn-hold.spec.ts`: shows a made-up push (`showView`) that passes the Turn,
  with the server's clock already past so only the local Playback holds, and
  asserts the heading and Turn number stay at the previous Turn through the
  Playback, then switch (with `--repeat-each 3` too). A `CardDrawn` step gives
  the assertions a 7 s window.
- The e2e app runs `vite preview` whenever `CI` is truthy (`Boolean`, so
  `CI=false` counts): build the web with `TEST_HOOKS=1` first, and unset `CI`
  (do not set it to `false`) to use the dev server.
