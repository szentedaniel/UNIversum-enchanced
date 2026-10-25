# Ticket #80 (per-event reveals): extension points and gotchas

Branch `ticket/80-reveals` (on `per-event-reveals`), spec #79, ADR-0005. The
engine snapshots the board at every `emit`, the push carries one reveal per
event, and the Playback core shows the current step's board. The Game screen,
the Board and the Decision module were not touched: they still read
`frame.view` only.

## Rules engine

- **The one derivation is `packages/rules/src/reveal.ts`**, not `view.ts`:
  `PlayerView`, `FieldView`, `Reveal` (`{ players, fields, doubler }`) and
  `revealOf(state)`. `publicView` spreads `revealOf(state)`. The module sits
  apart because `tx.ts` records a reveal at every `emit`, and `view.ts` imports
  `autoSellPicks`/`standingsOf`, which reach back to `tx.ts`: keeping `revealOf`
  in `view.ts` closes an import cycle (`oxlint`'s `import/no-cycle` fails).
  `index.ts` exports all four names.
- **`Tx.reveals`** is filled by `emit(tx, event)`, one reveal per event, in
  order; `Applied.reveals` is the same array. `Applied` is
  `{ state, events, reveals }` — a new consumer of `apply` must type it, but
  nothing else changed shape.
- **A reveal owns its objects.** `revealOf` copies the Players (and their
  `name`), the Fields and the `doubler` object; rule code keeps mutating
  `tx.state` after `emit` (`beginTurn` does, on every Turn passing). A reveal
  therefore shows the board at that event's emit, never a later one.
- **Ordering is not fixed here** (it is #82's job): rule code that emits before
  applying still shows its change with the _next_ event. `charge.ts`'s
  `goBankrupt` is the known offender — it returns the Fields to the Bank and
  sets `bankrupt` before emitting the Charge event, so that event's reveal
  already shows the bankrupt board. #82's two beats fix exactly that.
- `STATE_VERSION` is unchanged and no reveal reaches `GameState` or the store.

## Protocol and Room server

- `GameMessage` gained `reveals: Reveal[]`, parallel to `events`; there is no
  Zod schema (server → client only). A push with no events carries `[]`.
- `GameRoom.commit(applied, intent = "Start")` takes the engine's result as one
  argument (`Pick<Applied, "state" | "events" | "reveals">`): `play` and
  `timeOut` pass `result`, `startGame` passes
  `{ state: game, events: [], reveals: [] }`. `save(seats, game, events)` was
  left exactly as it was, so the stored event log cannot grow reveals; the
  reconnect push (`sendCurrent`) sends `events: [], reveals: []`.
- `restore`/`reconnect` need no change: a restored Room's first push is
  `sendCurrent`'s.

## Web client

- `Push` (`stores/room-store.ts`) and `PlaybackPush` (`playback/playback.ts`)
  both carry `reveals: readonly Reveal[]`; `connection.ts` copies it from the
  message.
- `playbackOfPush` builds **one merged view per step, once**, before returning:
  the final view with the step's `players`/`fields`/`doubler`, and each
  Player's `position` kept from the final view. `frameAt` returns that object
  (or `push.view` itself once `elapsedMs >= playbackOf(events)`, and for every
  step without a reveal). `board.ts` re-syncs on view identity, so never build
  a view inside `frameAt`.
- **The current step is `lastStarted(items, elapsedMs)`** — one helper over
  `{ startMs }`, shared with `cueAt`: the last item with
  `startMs <= elapsedMs`, zero-length steps included, the last of several at
  the same millisecond. Do not swap in `timeline.ts`'s `stepAt`, which skips
  zero-length steps and reports `null` between them.
- Everything tied to the next Decision (`phase`, `turn`, `currentPlayer`,
  `turnTimer`, `actsAfter`, `autoSell`, `pickOptions`, `standings`, `endsAt`)
  and every `position` come from the final view; only `players` (cash, Wealth,
  Bankrupt, Quarantine, PCR), `fields` and `doubler` change per step.
- `window.universumTest.showView(view, events?, reveals?)` now takes the
  reveals; without them (or without events) the final view shows at once. The
  e2e mirror `TestHooks` in `apps/e2e/tests/test-hooks.ts` matches.

## E2E

- `apps/e2e/tests/reveals.spec.ts` (`ADR-0005: …`) fakes a Rent push with
  `showView` (a random game can't be steered onto an owned Field) and pins that
  the payer's and owner's `[aria-label="Cash"]` change at the Rent step, not at
  the push. Its "before" assertions first wait for the made-up push's dice
  toast: the toast and the cards come from the same frame, so the read is the
  reveal-driven render, never a stale one.
- The Player cards or chips are one locator per Seat: `playerCards(page)` in
  `apps/e2e/tests/helpers.ts` (also used by `sale-tray.spec.ts`).
- The made-up push bases its "before" cash on the view it clones
  (`START_CASH`, 2,500,000) and its "after" on `± the Rent`. Format expected
  money in the same locale the browser uses: Node's ICU writes
  `HUF 2,500,000` for locale `"en"`, while the app (en-US,
  `currencyDisplay: "narrowSymbol"`) shows `Ft 2,500,000`; the spec formats with
  `"en-US"`.
- The Rent step is the dice plus the walk: budget the wait with
  `playbackOf([DiceRolled, Moved])` (ADR-0004), not a bare number.

## Web test fixtures

`apps/web/test/playback-fixtures.ts` exports `revealWithCash(cash, patch)` — a
two-Player reveal with the given cash and the pawns one Field behind the final
view — because `revealOf` is the engine's function and the two must not be
confused. `playersWithCash`/`fieldOf` build the final view's players and a
Field. `PlaybackPush`/`Push` in tests need `reveals: []` when a push carries
none.

## Verified on this branch

`pnpm install --frozen-lockfile`, `check:commits`, `oxfmt --check`, `lint`,
`-r typecheck`, the whole vitest run (967), the `TEST_HOOKS=1` web build, the
full e2e suite on 3180/5280 and `docker compose build`; `reveals.spec.ts`
repeated `--repeat-each 6 --retries 0` per project (12 passed).
