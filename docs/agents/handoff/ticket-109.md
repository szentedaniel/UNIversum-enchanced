# Ticket #109 (workflow fixes as pull requests): extension points and gotchas

Branch `agent/issue-109-retro-propose-workflow-fixes-as-pull-requests`. `AGENT_PAT` has Workflows
read/write (#107), so the nightly retro's `workflow-issue` kind became `workflow-pr` and now follows
the `standards-pr` route.

## Where the code is (`packages/factory/src/retro/`)

- **`schema.ts`** — the fix kinds are `issue`, `standards-pr`, `workflow-pr` and `none`; the last two
  carry `title`, `body` and a unified `patch`.
- **`plan.ts`** — both pull kinds plan one `PlannedWrite` member whose `kind` is
  `"standards-pr" | "workflow-pr"`, with `patch` and `branch: branchOf(date, title)`. The path check
  is still the only difference: `isStandardsPath` for one, `isWorkflowPath` (every path under
  `.github/workflows/`) for the other; a path outside is `Skipped: …`, not written. `workflowBody`
  is gone: both pull kinds use `standardsBody`, whose wording says "protected path".
- **`retro.ts`** — `openPatchPull` takes either pull write: it refuses an existing branch or a patch
  that does not `git apply --check`, pushes `retro/<date>-<slug>` with the PAT, then opens one
  `ready-for-human` pull request. The `workflow-issue` branch that called
  `createIssue(…, "ready-for-human")` is gone; only `issue` writes use `createIssue`.
- **`prompt.md`** — the model picks `workflow-pr` for a `.github/workflows/` cause; the patch may
  touch only that directory.

## Gotchas later tickets must know

- **The two pull kinds share one planned shape.** A caller that needs the kind reads `write.kind`;
  `Extract<PlannedWrite, { kind: "standards-pr" | "workflow-pr" }>` is the shared pull type.
- **A workflow pull request is still a protected path.** It is labelled `ready-for-human` and the
  owner merges it; do not add `.github/workflows/` to the merge gate's auto-merge paths.
- **`AGENT_PAT` can now push `.github/workflows/`.** This supersedes the permission note in
  `ticket-90.md`; the retro and the factory's other steps can propose or build workflow changes.
- **`isWorkflowPath` stays.** It keeps a model's patch inside `.github/workflows/`; a non-workflow
  path in a `workflow-pr` is skipped and logged.
- **Tests:** `packages/factory/test/retro-plan.test.ts` pins the schema kinds and a `workflow-pr`
  plan's `branch`/`patch`; run it with
  `pnpm exec vitest run packages/factory/test/retro-plan.test.ts`.
