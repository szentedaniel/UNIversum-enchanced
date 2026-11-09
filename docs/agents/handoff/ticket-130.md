# Ticket #130 (pick rules) — extension points and gotchas

Branch `agent/issue-130-pick-phases-one-module-for-the-doubler-and-erasmus`, from main at `b37f03d`.

## The seam

- **`doublerPlacement(state, field)` in `rules/doubler.ts`** is the Doubler
  placement rule (R60, R61, F11): `{ count, rent, rentAfter }`. `count` stacks
  when the token already sits on `field`, else it is 1; `rent` is `rentOf` now;
  `rentAfter` is the Rent once the token is there. The `PlaceDoubler` handler
  takes `count` from it, and `view.ts#pickOptions` takes `rent`/`rentAfter`.
- **`erasmusRoute(state, field)` in `rules/erasmus.ts`** is the Erasmus travel
  rule (R65): `{ steps, passesStart, bonus }`, from the current Player's
  position forward round the ring. `TravelErasmus` moves `steps` and lands;
  `pickOptions` builds the option from it. It reads `state.currentPlayer`, so a
  caller never looks the mover up itself.
- **`rentWithCount(state, field, count)` in `rules/pricing.ts`** is R61's
  multiplier with an explicit count; `rentOf` is `rentWithCount` with the
  state's Doubler. `doublerPlacement` uses it for `rentAfter`, so a change to
  the Doubler Rent rule reaches the option and the charge together.
- `view.ts#pickOptions` is now only the map over the phase's `fields`: it calls
  the corner function and copies the fields onto `PickOption`. A new corner
  pick adds a phase branch there and the rule in the corner's module.

## Gotcha

- **`erasmus-travel.ts` stays.** `landing.ts` imports `landOnErasmus` from
  `erasmus.ts`, so an intent in that module that imports `landOn` back is an
  `import/no-cycle` error (and a TDZ error on load, depending on the entry
  module). Folding the handler in needs the dispatcher injected (or the rule
  split again); the route function, the landing and the targets now share the
  corner's module, and only the handler sits apart. A new corner handler that
  needs `landOn` splits the same way.
- `PickOption` and the intent payloads are unchanged: no state, protocol or
  client change. `STATE_VERSION` is unchanged.

## Tests

- `test/doubler.test.ts` pins the option numbers and that the option's
  `rentAfter` is the Rent the Field charges once the token is placed there
  (R61); `test/erasmus.test.ts` pins `steps`/`passesStart`/`bonus` in the view
  and the same numbers on the `Moved`/`RoundBonusPaid` events. Both drive
  `apply` and `publicView` only; the new functions are internal.
