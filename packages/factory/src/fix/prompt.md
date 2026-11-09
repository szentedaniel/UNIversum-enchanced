# TASK

Fix pull request #{{PR_NUMBER}} on branch `{{BRANCH}}`. This is fix round {{ROUND}}.

You are on the branch, already checked out in this working directory with full history. There is no worktree to create: build and commit here.

# WHY THE PULL REQUEST IS BACK

{{PROBLEM}}

# WHAT TO DO

- Read the failure above and the pull request's own change: `git diff origin/main...HEAD`. When main moved, merging `origin/main` into the branch is the first step; resolve the conflicts keeping both sides' behaviour.
- Fix the cause, not the symptom: never skip, delete or weaken a test, never add `|| true` or swallow an error, never make CI green by lowering what it checks.
- Stay inside the pull request's change. Do not add features, dependencies, abstractions or files the ticket did not ask for, and do not reformat untouched code.
- Run the fast checks after a change, in this order: `pnpm exec oxfmt`, `pnpm run lint`, `pnpm -r run typecheck`, `pnpm exec vitest run`. Never run Playwright or `docker compose build`: CI owns those.
- `pnpm install` is already done. If you add or remove a dependency, regenerate the lockfile with `pnpm install --no-frozen-lockfile` (pnpm freezes it when `CI` is set) and commit it: CI installs with `--frozen-lockfile`.
- Commit with `type(scope): description`, a type from `packages/repo-checks/src/commits.ts`, and no AI attribution. One commit per green slice is fine.
- Leave the working tree clean: commit or revert everything before you finish. The workflow pushes your commits; you never push.

# NEVER

- Never push, never comment on or label the pull request, never open another one: the workflow does all of that.
- Change `.github/workflows/` only when the failure is in a workflow. Then run `actionlint` on it when it is installed. A workflow change is a protected path, so the owner merges it.

# REPORT

End your final message with the protocol's report, in its exact format and as plain text — no code fence:

```text
STATUS: DONE | BLOCKED
BRANCH: <the branch you committed on>
HEAD: <short sha of the last commit>

## What landed

- ...

## Checks

- each check you ran: pass/fail (+ vitest counts)

## Deviations from the ticket

- what and why (or "none")

## Question (only when BLOCKED)

- the decision you need, with the options you see
```

**Then put `<promise>COMPLETE</promise>` alone on the very last line.** It is Sandcastle's completion signal: without it the run assumes you are not finished and repeats this whole prompt, again, up to five times.
