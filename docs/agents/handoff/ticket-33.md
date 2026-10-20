# Ticket #33 (invariants and simulations): facts for later tickets

Branch `ticket/33-invariants` (on `v2-modernization` at `32c43ed`). Everything here is test-only plus the rules package's typecheck configs: no rule, protocol, server or web code changed.

## R-id coverage check (`packages/rules/test/coverage.test.ts`)

- Reads every other `*.test.ts` in `packages/rules/test` with `node:fs` (`import.meta.dirname`) and collects the `it("…")` titles. It scans **titles only**, expands `R25–R27`-style ranges (en dash or hyphen), and skips its own file so the exclusion reasons' ids do not count.
- `OUT_OF_SCOPE` is a `Record<number, string>` of ids the rules engine cannot test, each with a reason: **R1–R5** (Room size/code/full/password/Start belong to #34–#37), **R12** (username identity, superseded by ADR-0001), **R22** (the browser rolled, superseded — the server rolls), **R74** (Board countdown, client/e2e).
- The second test fails if an excluded id now has a test: remove the exclusion then.
- **To add a rule area:** name its tests by the rule id (`it("R42: …")`). **Never** put a range such as `R1–R80` in an `it` title outside `coverage.test.ts` — the scan would think every rule is covered.

## Engine purity guard (`packages/rules/test/purity.test.ts`)

- `tsconfig.src.json` compiles `src` alone with no Node types (`tsc --noEmit -p tsconfig.src.json`, run first by the package's `typecheck`); `process`, `Buffer`, `node:fs` and timers are compile errors there. The default `tsconfig.json` includes `src` + `test` so oxlint discovers it for both; only `coverage.test.ts` and `purity.test.ts` opt into Node types with `/// <reference types="node" />`.
- `purity.test.ts` scans every `src/**/*.ts` (comments stripped) and fails on: any built-in import (`node:` or bare, checked against `node:module`'s `builtinModules`), `process`, `Buffer`, `Date.now()`, `new Date()`, `Math.random()`, `setTimeout`/`setInterval`/`setImmediate` and `queueMicrotask()`. The engine's clock and randomness are `ctx.now` and the seeded PRNG in state.
- To test the guard: a `Date.now()` in `src` fails the test, and `process.env` in `src` fails `tsconfig.src.json`; neither should ever be "fixed" by adding Node types to the engine config.

## Seeded simulation driver (`packages/rules/test/simulation.ts`)

```ts
playRandomGame({ seed, choiceSeed, players, settings, timeoutEvery, steps, now, pick })
  → { state, steps: Step[], ended }

Step = { before, after, intent, now, events }
nextMove(state, pick, timeoutEvery) → { intent, now } | null
chooser(seed) → pick(n)  // the driver's LCG, not the game's PRNG
ledgerOf(before, events) → { bank, cash: Record<PlayerId, number> }
```

- **What it is:** a test-only full-game driver through `#index.ts`. It starts with `newGame`, and each step picks a legal move from the phase: `awaitingRoll` → Roll; `offer` → each offered Level / BuyMuseum / Buyout / Decline; `selling` → AutoSell or a random legal subset of the Player's Fields read from `publicView(...).fields[].sale`; `quarantineChoice` → the flags' options; `placingDoubler` / `choosingErasmus` → a Field in `phase.fields`. It never sends an intent the engine would refuse (a refusal throws with the intent and phase).
- **Time:** a normal move uses `now = turnDeadline - 1`; one in `timeoutEvery` moves (default 8) uses `TurnTimedOut` with `now = turnDeadline + 1`. Every accepted move therefore advances the clock ~23 s, so a 15-minute game ends in ~40 steps.
- **Adding a phase:** the `nextMove` switch ends in `const unhandled: never = phase`; TypeScript stops compiling until the new phase's legal options are added. Do that rather than a default roll — the driver's contract is "only options the phase lists".
- **The 40-game loop in `sale.test.ts` now calls the driver** (`seed: [g, g*7, g*13, g*31], choiceSeed: g`) and still asserts that Sales and Bankruptcies occur, so the random-play reachability check stays.

### Event ledger (`ledgerOf`)

The invariants assert `Σcash(after) − Σcash(before) === ledger.bank` and each Player's cash equals the ledger after every accepted intent. It is built from the event list in order:

| Events                                                | Ledger effect                                                                                                                        |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `RoundBonusPaid`, `ChanceMoneyReceived`, `FieldsSold` | Bank → Player (`bank += amount`)                                                                                                     |
| `LevelBought`, `MuseumBought`, `PcrTestBought`        | Player → Bank (`bank -= amount/price`)                                                                                               |
| `BoughtOut`                                           | Player → owner, bank-neutral                                                                                                         |
| `RentPaid`                                            | Player → owner; on Bankruptcy the payer's cash is clipped and the Bank makes up `amount − cash` (it bought the returned Fields, F12) |
| `TaxPaid`, `ChanceChargePaid`, `TimeoutPenaltyPaid`   | Player → Bank, clipped to the payer's cash so a Bankrupt payer's "raised" amount does not invent money                               |

**When adding a money event:** add its case here, or the conservation property fails. Also remember `goBankrupt` emits a Charge event whose `amount` is _what the player could raise_, not the cash held — that is why the charge cases clip.

## Invariants (`packages/rules/test/invariants.test.ts`)

- fast-check 4.10.2 (pnpm catalog, rules devDependency). `gameArb` varies the 4-word game seed (never all zero), `choiceSeed`, Players 2–4, Minute limit 15/30/50 and `timeoutEvery` 2–20. `RUN = { seed: 20261020, numRuns: 20 }` keeps runs reproducible; increase `numRuns` when touching the engine.
- One `it` per invariant from the spec: ends (under 500 intents), money ≥ 0, conservation through the ledger, Bankrupt never current / 0 cash / no Fields, every decision phase has `now + TURN_LIMIT_MS + TURN_SLACK_MS` and `gameOver` has `null`, Field owner/Level coherence and Doubler coherence, exactly one non-Bankrupt winner with exactly one `GameEnded`, and `publicView` never has `rng`/`guestToken`/`tokenHash`/`reconnectionToken` anywhere in its JSON. A replay test proves the same `{seed, choiceSeed, timeoutEvery}` gives the same intents and final state, so a fast-check counterexample is reproducible.
- **Lint gotchas:** `vitest/valid-expect` rejects the second "message" argument to `expect`; `vitest/no-conditional-expect` rejects any `expect` inside an `if`. Write checks as unconditional computed booleans (`expect(cond).toBe(true)`) or compute an `expected` value and compare once, even when the branch exists for narrowing.
- `import/no-named-as-default-member` rejects `fc.assert`/`fc.property`; import `assert`, `property`, `integer`, … by name.
- A quick tally over 100 seeded 50-minute games reaches every phase (`awaitingRoll`, `offer`, `selling`, `quarantineChoice`, `placingDoubler`, `choosingErasmus`, `gameOver`) and every intent including all three Quarantine choices — useful when changing the driver.
