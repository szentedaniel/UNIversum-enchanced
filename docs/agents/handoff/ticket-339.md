# Ticket #339 (Factory review follow-ups: #321) — facts for later tickets

Branch `agent/issue-339-factory-review-follow-ups-321`. Three refactors; no state, protocol or message change (`STATE_VERSION` stays 10, every rule number unchanged).

## Rules: one Doubler count

- `packages/rules/src/rules/pricing.ts` exports `doublersOn(state, field)`: the state's one Doubler's count when it stands on `field`, else 0 (R61, F10). It is engine-internal, like `levelRentsOf`/`basePriceOf` — not in `src/index.ts`.
- `rentOf` passes it to `rentWithCount`; `revealOf` (`packages/rules/src/reveal.ts`) fills `FieldView.doublers` with it, so the Rent and the view read the count one way. `reveal.ts` already imported the pricing rules, so no import cycle.
- `packages/rules/test/doubler.test.ts`, describe "the Doubler count on a Field": the `doublersOn` unit test (matching Field → count, another Field or no Doubler → 0). The existing Doubler-view, reveal, university and museum tests pin the behaviour.

## E2E: one `FieldView` fake

- `apps/e2e/tests/helpers.ts` `fieldView(patch: Partial<FieldView> = {})` builds the neutral eight-key view, each call with its own `levelRents` array (ADR-0005). Its `FieldView` comes from the `@universum/rules` type import in that file.
- Playwright serializes an `evaluate` callback, so a Node helper cannot be called inside `page.evaluate` (the browser has no such binding). The fakes therefore build their views in Node with `fieldView` and pass them as the evaluate argument: `helpers.ts` `showPick` and `showSale` pass a `views` object and the callback spreads `owner` (`me`/`other.id`) over each; `podium.spec.ts` `showGameOver` passes `FIELDS.map(() => fieldView())` as `fields`. A new fake view follows that shape.
- `pick-tray.spec.ts` no longer keeps its own `showPick` copy: it imports the shared step (see `ticket-388.md`).
- `field-card.spec.ts` still patches a real Field with `{ ...field, basePrice: 0 }` and was left alone (it reads only `levelRents[0]`).
- `apps/e2e` is covered by `pnpm -r run typecheck`; Playwright belongs to CI and was not run here.

## Web: glossary wording

- `apps/web/src/playback/playback.ts` `sameField`'s doc comment now says **Level Rent** table; the comparison is unchanged: owner ring, Level, Value, Rent, Sale, Level Rent table, base price and Doublers.

## Owner confirmation

- Finding 1 is not code: `basePrice` stays the Level 1 Value (`values[1]`, R26), the deviation already recorded in `GLOSSARY.md` **Base price**, the `FieldView.basePrice` comment in `reveal.ts` and `docs/agents/handoff/ticket-315.md`. The owner should confirm it.
