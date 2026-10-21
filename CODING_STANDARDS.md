# Coding standards

The judgement calls a reviewer checks a diff against. A rule a check already enforces is left out: `oxfmt`, `oxlint` and `tsc`; the import fence (`.oxlintrc.json` `no-restricted-imports`, `apps/web/test/import-fence.test.ts`); the engine purity guard (`packages/rules/test/purity.test.ts`); the Playback and server-clock fence (`apps/web/test/playback-fence.test.ts`); R-id coverage (`packages/rules/test/coverage.test.ts`); the state-shape snapshot guard (`packages/rules/test/migrate.test.ts`); message-key parity in hu/en/de (`apps/web/test/messages.test.ts`); flaky e2e (`failOnFlakyTests`); commit messages (`pnpm run check:commits`, `packages/repo-checks/src/commits.ts`); the implementer protocol's check list against CI (`packages/repo-checks/test/ci-protocol.test.ts`).

## Every area

- **Match the neighbouring code.** The hunk keeps the comment density, naming and idioms of the file around it; a new pattern carries its reason in the diff.
- **Tests drive the public interface.** They assert only what an outside caller sees: `apply` and `publicView` for rules, real SDK clients for the Room server, Playwright for the browser — never a private helper. A helper's own spec may call it directly: `failure-dump.spec.ts` tests `dumpPage`, because the fixture attaches only on failure. ([spec #22, Testing Decisions](https://github.com/szentedaniel/UNIversum-enchanced/issues/22))
- **Name a test by what it pins.** `it("R44: …")` for an inventory rule, `it("F12: …")` for an amendment, `it("ADR-0004: …")` for an ADR — in any package or app; the [rules inventory](docs/research/rules-inventory-v1.md) is the yardstick, and the spec's amendments win where they disagree.
- **Seed randomness, feed time in.** Randomness comes from a seed and time from `ctx.now` or the injected scheduler; a test never sleeps. ([spec #22, Testing Decisions](https://github.com/szentedaniel/UNIversum-enchanced/issues/22))

## Rules engine (`packages/rules`)

- **Phases carry their options; the view carries every number.** A decision phase lists its legal options in state, and `publicView` holds every number the UI shows — Rent, Value, Buyout price, what a Player can afford, Auto-sell's picks. ([spec #22, Modules](https://github.com/szentedaniel/UNIversum-enchanced/issues/22))
- **One intent runs to the next decision.** An intent applies every automatic consequence and returns the ordered events to animate; a step with no Player choice (a Chance card, the Quarantine notice) applies inside `apply` and has no intent of its own. ([ADR-0003](docs/adr/0003-rules-engine-is-a-pure-reducer.md))

## Protocol and server (`packages/protocol`, `apps/server`)

- **The server owns the rules.** A Room handler validates the intent, calls `apply`, stores and broadcasts; the rule and every computed number stay in the rules package. ([ADR-0001](docs/adr/0001-server-owns-the-game-rules.md))
- **Dependencies flow one way.** `web → protocol → rules` and `server → protocol → rules`; a package never imports the web app or the server. The web side is enforced by the import fence (`.oxlintrc.json` `no-restricted-imports`, `apps/web/test/import-fence.test.ts`); the server's imports and the packages' have no check, so a review must catch them. ([spec #22, Modules](https://github.com/szentedaniel/UNIversum-enchanced/issues/22))

## Web client (`apps/web`)

- **Every visible string is a message.** Text lives in `apps/web/messages/{hu,en,de}.json` (Paraglide), money goes through `Intl.NumberFormat` in the active language, and the server sends only ids, codes and numbers. ([spec #22, Client](https://github.com/szentedaniel/UNIversum-enchanced/issues/22))
- **Show the pushed view.** There is no optimistic UI: controls and overlays render from the last view in `roomStore`, a Rejection only clears the pending control, and the dice start on `DiceRolled`; a number or option the view carries is never hard-coded or recomputed. ([ADR-0001](docs/adr/0001-server-owns-the-game-rules.md), [spec #22, Client](https://github.com/szentedaniel/UNIversum-enchanced/issues/22))
- **A Playback step decides what to show.** `apps/web/src/playback/timeline.ts` gives each step its `kind`; an overlay or control switches on that `kind`, never on `event.type` again. ([ADR-0004](docs/adr/0004-rules-engine-times-the-playback.md))

## E2E (`apps/e2e`)

- **A wait after a Playback budgets for it.** Compute the timeout with `playbackOf` or `playbackOfEvent` over the worst-case events, never a bare number. ([ADR-0004](docs/adr/0004-rules-engine-times-the-playback.md))
- **One home for shared steps.** A step another spec already has goes into [`apps/e2e/tests/helpers.ts`](apps/e2e/tests/helpers.ts), never a copy in the spec.
- **Drive the real screen.** Playwright acts through the UI and the test-only hooks (`fieldCenter`, the current view), and asserts on the DOM and the view — no screenshots, no React internals. ([spec #22, Testing Decisions](https://github.com/szentedaniel/UNIversum-enchanced/issues/22))

## Docs

- **Glossary terms in, avoided synonyms out.** Code, test names and messages use the term [`GLOSSARY.md`](GLOSSARY.md) defines, never the synonym it lists under _Avoid_.
- **A changed decision lands in its ADR.** A diff that contradicts [`docs/adr/`](docs/adr/) amends that ADR in the same commit; a new domain concept goes into the glossary.
