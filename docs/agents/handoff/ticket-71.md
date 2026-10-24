# Ticket #71 (typed test views): extension points and gotchas

Branch `ticket/71-typed-test-views` (on `v2-modernization`), spec #72. Type-only
refactor: no behaviour, no message and no rule changed. The proof is `tsc` on
`apps/e2e` and `apps/loadtest`, the loadtest vitest and the full e2e suite.

## The load-test bot (`apps/loadtest/src/bot.ts`)

- `isGameOver(view)` is now `view.phase.kind === "gameOver"`; the hand-written
  `FINISHED_PHASES = new Set(["gameOver", "ended"])` is gone (`"ended"` was
  never a phase). A misspelled kind now fails `tsc` instead of silently
  missing every game-over view. `bot.test.ts` pins that an invented `"ended"`
  phase is not the end.
- `View = GameMessage["view"]` stays: the protocol's `GameMessage.view` is
  `PublicView`, so the bot already held the real type. `@universum/loadtest`
  still does not depend on `@universum/rules`; do not add it for a type.
- `offeredIntents`'s `default: return []` is deliberate: a phase a later ticket
  adds is left to the Turn timer, never guessed.

## The e2e hooks (`apps/e2e/tests/test-hooks.ts`)

- The mirrors `ViewSummary`, `ViewPlayer`, `FullPickOption`, `FullPhase` and
  `FullView` are deleted. The hooks use the rules engine's types, type-only:
  `PublicView` (the pushed view and `view()`), `Phase` (`PageDump.view.phase`)
  and `PhaseOf<"offer">` (`helpers.ts`'s `OfferPhase`). Type imports are erased,
  so `page.evaluate` bodies are unaffected; never put a runtime import in one.
- What stays here is what has no rules counterpart: `Camera`, `PlaybackSample`,
  `PickMarks`, `SocketCall`, `Rejection`, `PlaybackHook`, the `Window` globals
  and `TestHooks`. `view()` returns `Board["view"]`, i.e. `PublicView | null`
  (the last drawn frame's view, so poll after a push); `showView` takes a whole
  `PublicView` and `readonly GameEvent[]` — the web hook's signature, so a
  made-up push carries real events — and `room().push.view` is one.
  `helpers.ts`'s `showChance` takes a `ChanceCardId`, not a bare string.
- A made-up view is a `structuredClone` of the latest pushed view with fields
  overwritten (sale-tray, pick-tray, podium, background-tab). Since the type is
  now the real union, `phase` must be a whole phase: `offer.levels` is required
  (`buyout`/`museum` only when offered), `selling.resume` is a `PendingCharge`,
  `PlayerView` carries `wealth`, `FieldView` carries `sale`.
- `PublicView` is the full view, not the Board's summary: the old `ViewSummary`
  was a subset and lied about `fields[].sale` and the phase options.
- A new decision phase reaches the specs through the rules declaration merging
  alone; the view type carries it. `helpers.ts`'s `resolveDecision` switch ends
  in `return null`, so a new phase compiles there and resolves to nothing —
  add its case when the phase needs acting on.
- Older notes' mentions of `FullView`/`FullPhase`/`ViewSummary` (ticket-27,
  -29, -31, -32) are historical: the names no longer exist.

## Verified on this branch

- `pnpm -r run typecheck`, the loadtest vitest (87), the whole vitest run
  (951), `TEST_HOOKS=1` web build and the full e2e suite on 3171/5271, with
  `sale-tray`, `pick-tray`, `podium`, `chance-card` and `two-guests` repeated
  `--repeat-each 6 --retries 0`.
