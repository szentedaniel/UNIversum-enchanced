# Ticket #195 (Bot policy) — extension points and gotchas

Branch `agent/issue-195-bot-policy-for-every-decision`, from main at `3108013`.

## The seam

- **`botIntent(view: PublicView): PlayerIntent | null`** in
  `packages/rules/src/bot.ts`, exported from the package root
  (`packages/rules/src/index.ts`). It answers the open Decision from the same
  `publicView` a client gets: no clock, no randomness, no PRNG state. The
  Room server (#196, #198) calls `botIntent(publicView(state))` and applies the
  result with `state.currentPlayer` as the actor, after the Decision gate.
- The switch on `view.phase.kind` is exhaustive and has no Timer fallback: a
  new Decision phase fails typecheck until it gets a case. `gameOver` returns
  `null`.
- Covered Decisions: Roll (`Roll`), Offer (`BuyLevel`/`BuyMuseum`/`Buyout`/
  `DeclineOffer`), Quarantine (`UsePcrTest`/`BuyPcrTest`/`RollForTwelve`), Sale
  (`SellFields`), Doubler (`PlaceDoubler`) and Erasmus (`TravelErasmus`).
- The one heuristic constant is `CASH_RESERVE = 500_000`: a purchase is only
  taken when its price leaves that much cash. A Buyout additionally needs a
  Field already owned in the same Group; a Sale keeps whole Monopolies and the
  Doubler's Field last, then sells the cheapest first.
- The policy reads **static** Board data (`FIELDS`, `MAX_LEVEL`,
  `MUSEUM_VALUE`) for Group membership and an unowned Field's price. That is
  public rules data, not hidden state; the dynamic input is still only the
  view.

## Gotchas

- `FieldView.value` is 0 for an unowned University (Level 0), so the Erasmus
  score takes an unowned Field's Level-1 price from `FIELDS[id].values?.[1]`
  (a Museum uses `MUSEUM_VALUE`). Do not read `field.value` for a Field the
  Bot does not own.
- `view.pickOptions` is the source of the pick numbers: a Doubler option's
  `rentAfter` already prices the stack (R60), and an Erasmus option carries the
  Round `bonus`. It is `null` outside a pick, and the option kinds are
  discriminated by `kind`, so filter before reading a kind-specific field.
- `view.fields` is indexed by Field id; `phase.fields` lists the legal ids.
- The tests use the deterministic test seed's first Roll of `[3, 6]`;
  `rollOnto` still works for any Field, but a landing before Field 9 wraps
  Start and pays the Round bonus.

## Tests

- `packages/rules/test/bot.test.ts`: one describe per Decision kind, driving
  real states through `apply`/`publicView`, plus the property test and a
  same-seed replay. No policy unit test calls a private helper.
- `playBotGame(options)` in `packages/rules/test/simulation.ts` plays a seeded
  game with every Decision answered by `botIntent` and no Turn timeout (5000
  intents max). It throws if the engine refuses an intent, and returns
  `{ state, steps, ended }` like `playRandomGame`. #200 extends it by adding
  the Deal phase to the policy; the driver needs no change.
