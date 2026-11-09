# Ticket #87 (merge gate and fix loop): extension points and gotchas

Branch `ticket/87-merge-gate`, the third ticket of spec #85. A pull request now finishes itself: the
merge gate merges it when CI, the review and the risk label agree and no protected path or dependency
major is touched; otherwise omp gets it back — red CI, review findings, or a `main` that moved — at
most twice, then the owner does. Nothing of the game changed.

## The merge gate (`packages/factory/src/merge/`)

- **`gates.ts` is pure** and holds every rule; `test/gates.test.ts` builds `MergeFacts` literals.
  - `PROTECTED_PATHS` / `HANDOFF_DIR` / `isProtectedPath` / `protectedPaths`: the spec's Decision 5
    list, with `docs/agents/handoff/` as the exception (every implementer writes a handoff note and
    its INDEX line). Add a path to the list, nothing else.
  - `dependencyMap` / `majorOf` / `majorBumps`: `package.json` fields only; major is the first
    non-zero number (`0.4.2` → 4). A `catalog:`/`workspace:`/tag version has no major to compare, and
    an added or removed dependency is not a major change.
  - `ciState(runs, headSha)`: the newest run for the head wins, so a successful re-run beats the
    failure before it. `pending` covers queued/in_progress.
  - `reviewState(facts)`: reads the newest `<!-- factory-review -->` comment; `stale` when it was
    posted before the head commit (a push invalidates a review) and `unreadable` when the heading is
    gone.
  - `canAutoMerge(facts)`: CI success, pass review, `risk:low`, no blocking label, no protected path,
    no dependency major. Every failing condition is a reason, in this order: CI, review, risk,
    labels, protected paths, majors.
  - `mergeStep(facts)`: the action for the workflow — `merge`, `wait`, `requeue-review`, `fix`
    (`main-moved`) or `escalate`. It checks queued/owner labels first, then behind/dirty, then CI,
    then the review, then the gate. `isFactoryPull` (branch `agent/…` or label `factory`) and
    `mainMovesWorkflows` (`.github/workflows/`) are here too.
- **`merge.ts`** is the thin script (`DRY_RUN=1`): `gh pr view` for the facts (its jq also lowercases
  nothing; `mergeState` is lowercased in code), the files API, `actions/workflows/ci.yml/runs?branch=…`
  filtered by `headSha`, the issue comments (through `#shared/github.ts`), and
  `compare/<head>...main` for `ahead_by` (main moved), the merge base and main's files. Dependency maps come from
  the contents API at the merge base and the head. Actions: merge (`gh pr merge --merge`, then an
  issue comment naming the merge commit and a close), re-queue `agent:review`, dispatch
  `factory-fix.yml -f reason=main-moved`, or comment the reasons and add `ready-for-human`.

## Reading a review comment (`review/summary.ts`)

`summaryComment` and the merge gate's readers live together: `HEADINGS` is the one place the two
headings are written, and `reviewVerdictOf` / `mergeDangerOf` / `newestMarkerComment` read them back.
Changing the heading, the `**Merge danger:** <door> door, <blast> blast radius. <reason>` line, or the
`REVIEW_MARKER` breaks the gate (a test round-trips the writer through the readers). The escalation
reason quotes the danger line: `one-way door: …` / `wide blast radius: …`.

## The fix loop (`packages/factory/src/fix/`)

- **`reasons.ts`**: `FixReason` = `ci | review | main-moved`, shared with `mergeStep`.
- **`rounds.ts`**: `MAX_FIX_ROUNDS = 2`, the hidden marker `<!-- factory-fix:round N -->`
  (`fixRoundOf`/`fixRounds`/`fixDecision`), `roundComment`, `mainMovedComment` (no marker: merging main
  is housekeeping, not a round).
- **`excerpt.ts`**: `excerptOf` keeps the log's tail, on a line boundary, bounded by `EXCERPT_CHARS`.
- **`decide.ts`** (run from main's checkout, before any install): fetches the comments, counts the
  rounds, builds the failure context into `problem.md`, and writes `plan.json`
  (`{run, round, reason, escalate}`). A spent budget writes `escalation.md`; the escalation is
  deduped by `<!-- factory-fix:escalated -->`, so repeated triggers post one comment.
- **`fix.ts`**: `main-moved` merges `origin/main` with git and only reaches omp on a conflict (the
  conflict is aborted first); `ci`/`review` run omp with `problem.md`. It fails on a `STATUS: BLOCKED`
  report, a dirty tree, or no new commit — the workflow then labels the pull request. The comment it
  writes is `fix-comment.md`.

## The workflows

- **`factory-merge.yml`**: `workflow_run` of `CI` and `Factory Review` (completed) plus
  `workflow_dispatch` (`pr`, `dry_run`). The job `if:` skips CI runs on `main` (event `push`) and the
  review cron's own run (its run-name `Factory review #night queue` fails the numeric resolve). A
  review dispatched by the cron has no `workflow_run.pull_requests`, so the number is read from the
  run-name — **renaming the review run-name must keep `#<n>`**, as with the dispatcher's run-name.
  Concurrency is per pull request; gate code is checked out from `main`.
- **`factory-fix.yml`**: `workflow_run` of `CI` (completed, `failure`, `event == pull_request`) plus
  `workflow_dispatch` (`pr`, `reason` = `review | ci | main-moved`, which is how the review and the
  merge gate start it). The preflight skips a PR that is closed, not `agent/…`/`factory`, whose head
  moved since the CI run, or one already held by `agent:blocked`/`ready-for-human` (a manual dispatch
  clears those first). It checks out **main** for `decide.ts`, then the branch for `fix.ts`; installs
  happen only when `plan.run` is true. The push uses `AGENT_PAT`; CI then re-runs and merge decides.
- **`factory-review.yml`** now dispatches `factory-fix.yml -f pr=… -f reason=review` on a
  changes-requested verdict and no longer adds `ready-for-human` for it. The review gates on the PAT's
  `actions: write` permission; a rename of `factory-fix.yml` must change this line too.

## Gotchas later tickets must know

- **The merge gate must run main's copy.** The gate reads the PR only as data (API). Never move the
  merge decision to the PR checkout: `review.ts`/`prompt.md` already run from the PR (#86), so a PR
  editing `packages/factory/` is `ready-for-human` _and_ the gate itself stays trustworthy.
- **The PAT has no Workflows permission.** A `main-moved` merge whose new commits change
  `.github/workflows/` is escalated (`mainMovesWorkflows`); the `compare` files list is capped at 300,
  so the push failure path in the fix workflow is the backstop.
- **Labels are the merge gate's queue.** `agent:review` on a PR means a review is coming: never merge.
  `ready-for-human`/`agent:blocked` mean the owner has it: never merge, and don't post the escalation
  comment again (it is deduped by the label, not a marker).
- **The merge commit's subject is `chore(merge): #<issue> <title>`.** The issue number comes from
  `closingIssuesReferences` or `closingIssue(body)`; a factory PR that closes no issue fails the gate.
- **A merge needs no dispatch call.** The push to `main` triggers `factory-dispatch.yml` itself
  (`on: push: branches: [main]`); saying otherwise in a doc would be wrong.
- **CI re-runs on the fix push** because the fix uses `AGENT_PAT`. A fix left on the branch with the
  job token would never be checked.
- For #89 (triage/retro) and anything that reads the factory's trail: the merge escalation comment
  opens with `<!-- factory-merge -->`, the fix round with `<!-- factory-fix:round N -->`, the
  escalation with `<!-- factory-fix:escalated -->`.
