# Ticket #65 (one presentation table for every event): extension points and gotchas

Branch `ticket/65-event-presentation` (on `v2-modernization`). Spec #63's
_Presentation table_: every event's overlay, toast tone and toast text now
comes from `apps/web/src/playback/presentation.ts`. `timelineOf`, `Game.tsx`
and the toast all read it. The Playback core (#66) builds on the same file.

## The table (`apps/web/src/playback/presentation.ts`)

- `EVENT_PRESENTATION: PresentationTable` — one row per `GameEvent["type"]`,
  typed as `{ [T in GameEvent["type"]]: Presentation<T> }`, so a new event
  type fails `pnpm -r run typecheck` until it has a row (checked by adding
  `ProofEvent` to the rules `EventMap`). A row is `{ overlay, tone, text? }`:
  - `overlay`: `"dice"` (only `DiceRolled`), `"card"` (only `CardDrawn`),
    `"toast"`, or `"none"` (`Moved`, `TurnPassed`, `OfferDeclined`). Hidden
    events are explicit now; "zero duration means hidden" is not the rule.
  - `tone`: `"notice"` (accent sticker) for the former `NOTICES` set —
    QuarantineEntered/RoundUsed/Released, PcrTestBought/Used, RentPaid,
    CardDrawn, TaxPaid, WentBankrupt, GameEnded — and `"routine"` otherwise.
  - `text(event, view)`: the toast line from Paraglide `m.*`, typed per event.
    It is absent for `Moved`, `TurnPassed`, `OfferDeclined` and
    `DoublerPlaced`; the status row keeps the previous line up through those.
- Readers: `presentationOf(type)` (row typed per event), `toneOf(event)`
  (`"notice" | "routine"`), `eventText(event, view)` (`string | null`) and
  `withOverlay(event)` (`{ kind, event }` with the dice/card payload narrowed,
  used by `timelineOf`).
- `withOverlay` holds the one type assertion: the table pairs a `dice` overlay
  with `DiceRolled` and a `card` overlay with `CardDrawn`, which TypeScript
  cannot follow through a lookup. `presentation.test.ts` pins both rows; if
  that pairing ever changes, `OverlaidEvent` and the step union must change
  with it. A new overlay kind means extending `Overlay`, `OverlaidEvent` and
  `PlaybackStep` together.

## Adding an event

Three compile-time gates now: the rules `EventMap`, `PLAYBACK_MS` in
`packages/rules/src/playback.ts` (even `0`), and an `EVENT_PRESENTATION` row.
The web typecheck names the missing property.

## What still decides presentation

- `playback/timeline.ts`: `stepOf` is a table lookup (`withOverlay` plus the
  duration); the old `switch (event.type)` is gone. `PlaybackStep.kind` is the
  overlay, and the discriminated union still narrows `dice` to `DiceRolled`
  and `card` to `CardDrawn`, which `Game.tsx`'s overlay switch (and #66's
  frame) rely on.
- Durations still come only from `@universum/rules/playback`
  (`playbackOfEvent` scales `Moved` by `steps`). No `*_MS` constant lives in
  `playback/`; the fence still passes.
- `Game.tsx` reads `toneOf(toast.event) === "notice"` for the toast tone; the
  `NOTICES` map is gone.
- `text.ts` no longer has `eventText`; it keeps `fieldName`, `formatMoney`,
  `playerName`, `chanceCardText`, `rejectionText`, etc. The table imports
  those helpers from `#text.ts`, so `#text.ts` must never import from
  `playback/` (that would close a cycle).

## Messages

- `event_turn_passed` and `event_offer_declined` are deleted from
  `messages/{hu,en,de}.json`; the events are hidden, so their text never
  showed. Run `pnpm --filter @universum/web run paraglide` after a message
  edit (the generated output is gitignored).

## Tests

- `apps/web/test/presentation.test.ts` pins every event's overlay and tone
  (`SHOWN`), pins the four textless events, and checks each row that has text
  returns a non-empty line in hu, en and de (`overwriteGetLocale`, the
  `money.test.ts` technique). `SAMPLES` is a
  `satisfies Record<GameEvent["type"], GameEvent>`, so a new event must also
  gain a sample here.
- `timeline.test.ts` passes as it was (no import change was needed).
- `turn-hold.spec.ts` and the other e2e specs pass unchanged; the full suite
  is the behaviour proof that no visible string or timing changed.

## For #66

- Import the table from `#playback/presentation.ts`; do not re-implement text
  or tone in the Playback core. A cue is `{ event, text: eventText(event, view),
  tone: toneOf(event) }`; `toastCues` already skips `kind: "none"` steps and
  null lines, which is the "previous line stays up" rule.
- `Overlay` is the step `kind` vocabulary; do not introduce a second name for
  it. The table's `overlay` is the only source for `PlaybackStep.kind`.
