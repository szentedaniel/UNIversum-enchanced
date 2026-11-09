# Ticket #98 (dispatcher log): extension points and gotchas

Branch `agent/issue-98-factory-dispatcher-says-why-it-dispatched-nothing`, spec #85. The dispatcher's
`Dispatch: none` line now names its cause instead of always claiming no free slot.

## Where the line comes from

- **`noDispatchReason(eligible, running, maxParallel)`** in `packages/factory/src/dispatch/plan.ts` is
  the one place the no-dispatch message is chosen, next to `planOf`. An empty `eligible` prints
  `Dispatch: none — the frontier is empty.`; otherwise the cap message prints
  `Dispatch: none — no free slot (<running> of <max> running).` The exact strings are pinned in
  `packages/factory/test/plan.test.ts`.
- **`dispatch.ts` only prints it.** `main` builds the plan, checks the budget, then calls the
  function with `frontier.eligible`, `running.length` and `maxParallel`. A new no-dispatch cause
  belongs in `noDispatchReason`, not another branch in `dispatch.ts`; a new cause that is not about
  the frontier or the cap (like the budget) belongs beside the budget branch.

## Gotchas

- **The budget branch short-circuits first.** `Dispatch: none — the <YYYY-MM> budget is spent.` is
  printed before the plan's reason, so `noDispatchReason` is only reached with the budget unspent.
- **The message is about the frontier, not `plan.waiting`.** With `plan.dispatch` empty they are the
  same set today (`planOf` slices `eligible`), but the function takes `eligible` so a change to the
  slice rule does not silently change which cause is reported.
- **`running` can exceed `maxParallel`.** Cancelled dispatches leave runs behind; the message reports
  the raw counts (`3 of 2 running`), the way the `Implementers:` line above it does.

Read for: any dispatcher log, `planOf` or dry-run output touch.
