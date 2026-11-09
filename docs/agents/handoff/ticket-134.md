# Ticket #134 (architecture run configuration): extension points and gotchas

Branch `agent/issue-134-move-the-architecture-pass-s-run-configuration-cap`. The architecture pass's
run policy moved out of `maintain/run-architecture.ts` into `maintain/proposals.ts`, so the script is
I/O only and the policy is testable without a sandbox.

## The seam

`architectureRun(env: {MAX_PROPOSALS?, FOCUS?}, now: Date)` returns an `ArchitectureConfig`:

- `max`: `DEFAULT_MAX_PROPOSALS` (2) when `MAX_PROPOSALS` is unset or blank, else the parsed lift.
  `MAX_PROPOSALS_LIMIT` (20) is private; a non-integer or out-of-range value throws the old
  `MAX_PROPOSALS must be an integer from 1 to 20, got '…'.` message. The script's top-level catch
  hands that to `fail`, so `failure_reason.txt` is unchanged.
- `focus`: `FOCUS` split on whitespace, empty entries dropped; an empty list means the whole
  repository. `run-architecture.ts` uses it for the `git log` pathspec.
- `schema`: `proposalsSchemaOf(max)`, passed to Sandcastle's `Output.object`.
- `promptArgs`: `{DATE, MAX_PROPOSALS, CAP_RULE, FOCUS}`. `DATE` is the injected clock's UTC date;
  `CAP_RULE` is the picky sentence at the default cap and the sweep sentence above it; `FOCUS` is
  `the whole repository` or the backticked paths.

`RECENT_COMMITS` stays in `run-architecture.ts`: it shells out to `git log` over `focus`, so it is
impure and not part of the config. The script spreads `...promptArgs` and adds it.

## Gotchas

- A new prompt argument that depends only on env or time belongs in `architectureRun`'s
  `promptArgs`; an argument that shells out stays in the script after the spread.
- `packages/factory/test/proposals.test.ts` pins the cap's effect through the public return value:
  the default gives the picky rule, a lift gives the sweep rule, a bad cap throws, an empty focus
  reads as the whole repository, and the schema's bound moves with the cap. The two `CAP_RULE`
  sentences are pinned by phrase, not in full, so wording can change without a brittle test.
- Changing what a placeholder means belongs in `maintain/prompt.md` and `architectureRun` together;
  the prompt file is the other half of the contract.
