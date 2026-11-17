# Ticket #388 (Factory review follow-ups: #386) — facts for later tickets

Branch `agent/issue-388-factory-review-follow-ups-386`. One e2e refactor; no rules, protocol, web or message change.

## E2E: one `showPick`

- `apps/e2e/tests/pick-tray.spec.ts` imports `showPick` from `./helpers.ts`; its own copy and doc comment are gone, and `fieldView` left the import (nothing else in that spec built a view). The three tests are unchanged: they still `await showPick(page, "doubler" | "erasmus")`.
- The spec keeps `VESZPREM` (1), `BUDAPEST` (2), `BERLIN` (15), `LONDON` (21) and `MUSEUM_4` (28) because the tests assert on the Board's ids; `helpers.ts` `PICK_FIELDS` holds the same four pick ids for the callback argument. The two lists must stay in step.
- `helpers.ts` `showPick`'s doc comment no longer claims a second copy exists; `mobile.spec.ts` imported the step before, so it now has two callers.
- `Page` stays imported from `@playwright/test` for the spec's `pick` and `tapField`; `fieldCenter` stays for `tapField`.

## Not code: `FieldView.basePrice`

- The ticket's second item is owner confirmation only: `FieldView.basePrice` is the Level 1 Value (`values[1]`, R26), as `GLOSSARY.md` **Base price**, the `FieldView.basePrice` comment in `packages/rules/src/reveal.ts` and `docs/agents/handoff/ticket-315.md` already say. Nothing changed for it.

## Checks

- `pnpm exec oxfmt --check`, `pnpm run lint`, `pnpm -r run typecheck` (which covers `apps/e2e`) and `pnpm exec vitest run` passed here; Playwright belongs to CI and was not run.
