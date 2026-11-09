# Ticket #108 (Workflows permission): what changed and what to watch

Branch `agent/issue-108-factory-drop-the-workarounds-for-the-pat-s-missing`.
`AGENT_PAT` has Workflows read/write (#107), so the workarounds the missing permission forced are
gone. No game code changed.

## The changes

- `packages/factory/src/merge/gates.ts`: `WORKFLOWS_DIR` and `mainMovesWorkflows` are deleted, and
  `mergeStep` no longer escalates a `needsMain` pull request whose new commits touch
  `.github/workflows/`: it returns `{ kind: "fix", reason: "main-moved" }` like every other
  `needsMain` case (a conflict, or main changing a non-handoff file the pull request changes too).
  `facts.mainFiles` still feeds `needsMain` only.
- `.github/workflows/factory-implement.yml`, "Push the branch": the step is
  `git push --force origin "$BRANCH"`; the `git fetch origin main` / `git merge origin/main` catch-up
  is gone, so a ticket that changes a workflow is pushed as its branch wrote it.
- `docs/agents/factory.md`: the `AGENT_PAT` paragraph says Workflows read/write and that `.github/`
  stays protected, so the owner merges those pull requests; the merge-gate paragraph drops the
  workflow escalation sentence.
- `packages/factory/test/gates.test.ts`: the escalation test now expects `main-moved`, and the
  `mainMovesWorkflows` tests are gone.

## Gotchas later tickets must know

- **`.github/` is still a protected path.** A workflow pull request is built and CI-checked, then
  `ready-for-human`; the merge gate never auto-merges it. `PROTECTED_PATHS` in `gates.ts` is the one
  place that list lives.
- **The push no longer catches up with main.** That catch-up existed only to make the branch's
  workflow files match main's current copy, which GitHub required without the permission. If main
  changed a workflow after the branch was cut, the branch keeps its older copy and the pull request
  shows that difference (and waits for the owner).
- **Not changed here:** the step prompts (`implement`, `fix`, `review`, `maintain`) still carry the
  "the factory's token cannot push it" rule, and the retro's `workflow-issue` kind still opens an
  issue with the patch inline (#109 replaces that kind).
- **This note supersedes ticket-87's** `mainMovesWorkflows` gotcha; the `compare` files list is still
  capped at 300, so `needsMain` can miss a shared file.
