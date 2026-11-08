# Ticket #88 (dispatcher): extension points and gotchas

Branch `ticket/88-dispatcher`, spec #85. The factory now picks its own next tickets: a run reads the
frontier, the implementers already going and the month's billed minutes, then dispatches
`factory-implement` for what fits. Nothing of the game changed.

## The modules (`packages/factory/src/dispatch/`)

- **`frontier.ts`** — pure. `frontierOf(issues, pulls, busy)` → `{ eligible, skipped }`, both oldest
  first. The rules, in the order the reason is chosen: `agent:in-progress` → `agent:blocked` →
  `ready-for-human` → `busy` (a queued or running run) → open blockers (`openBlockers`, the fetches'
  open ones) → sub-issues (`subIssues`) → an open pull request whose body closes it (`closingPull`).
  `IssueFacts` is the dispatcher's shape, not the REST shape: `blockedBy` is the
  `issue_dependencies_summary` pre-filter, `openBlockers` the dependencies call's open entries.
  `PRIORITY_LABELS` is the one seam for a priority label: add one and the comparator sorts it above
  age; nothing else changes.
- **`budget.ts`** — pure. `jobMinutes` (per job, `Math.ceil`, a running job counts to `now`),
  `minutesUsed`, `monthStart` (midnight UTC on the 1st: the runs API's `created=>=` filter),
  `isFactoryWorkflow` (`.github/workflows/factory-*.yml`), `budgetNotice(used, limit, month)` (the
  month-scoped marker `<!-- factory:budget:YYYY-MM -->`, the title and the body). The limit's default
  is `DEFAULT_MONTHLY_MINUTES = 1400`.
- **`plan.ts`** — pure. `planOf(eligible, running, maxParallel)` → `{ dispatch, waiting }`; the
  headroom is `max(0, cap - running)`, `DEFAULT_MAX_PARALLEL = 2`.
- **`dispatch.ts`** — the script: `gh api --paginate --slurp` for every read (runs, jobs, issues,
  blocked_by, pulls, comments), prints the plan, then `gh workflow run factory-implement.yml -f
  issue=<n>` per chosen issue, or the budget notice. `api()` is the one untyped boundary (a
  `typescript/no-unsafe-type-assertion` disable with its reason): the REST shapes are the interfaces
  at the top of the file. No package dependency, so the workflow runs it with plain `node` after
  `actions/setup-node` — no `pnpm install`, no Bun, no agent.

## The workflow (`.github/workflows/factory-dispatch.yml`)

- Triggers: `workflow_run` of **Factory Implement** (`completed`: a slot frees), `push` to `main` (a
  merge unblocks dependants), `workflow_dispatch` (`dry_run` boolean) and a 6-hourly cron backstop. A
  2-hourly cron alone bills ~360 minutes a month for nothing. `concurrency: factory-dispatch` with
  `cancel-in-progress: false`: two triggers take turns, and the second sees the first's dispatches.
- `DRY_RUN: ${{ inputs.dry_run && '1' || '' }}`; the script treats only `"1"` as dry. A dry run
  prints the frontier with each skipped issue's reason, the running count, the budget and the plan,
  and writes nothing (no dispatch, no comment, no issue).
- `FACTORY_MONTHLY_MINUTES` and `FACTORY_MAX_PARALLEL` come from repository variables; unset, `0`,
  negative or misspelt values keep the defaults (`positiveInt` in `src/shared/common.ts`).
- The dispatcher's own run is a `factory-*` workflow, so it counts toward the month it runs in
  (started, rounded up).

## Gotchas later tickets must know

- **The run's name is the issue lock.** `factory-implement.yml`'s `run-name` is now quoted
  (`"Factory implement #${{ inputs.issue }}"`): unquoted, YAML read `#${{ … }}` as a comment and the
  number was lost — the API's `name`/`display_title` was just `Factory implement`. `issuesOfRuns` in
  `dispatch.ts` parses `#<n>` back out of `run.name`; a name without a number still counts as a
  running implementer, it just cannot claim its issue. Renaming the run-name must keep the `#<n>`.
  The label alone is not enough: the implement run sets `agent:in-progress` only once it starts, and
  a queued run would otherwise be dispatched a second time.
- **The closing-PR test exists twice.** `src/shared/closing-pr.ts` (`closesIssue`/`closingPull`) is
  the TypeScript side; `factory-implement.yml`'s preflight asks the same question with the same
  pattern in jq. The context for #88 allowed reusing the query rather than moving it into the
  package (the preflight runs before the checkout, so it cannot import a module); **change both
  together**. A later ticket could move the preflight after the checkout and call one implementation.
- **Budget reads the jobs API, not `/timing`.** `billable` is unreliable; `started_at`/`completed_at`
  per job, rounded up, is how GitHub bills. Runs are filtered by `created` in the current UTC month,
  so a run that starts on the 31st and ends on the 1st bills to the month it started.
- **The budget notice dedupes across all open `factory:report` issues**, not just the newest: the
  weekly report (#89) may open a new issue each week, and the marker must still stop the second post.
  When none is open the dispatcher opens `Factory report — YYYY-MM` with the `factory:report` label;
  the weekly report step should comment on that issue instead of opening a second one.
- **`GH_REPO` is required**; `GH_TOKEN` is the PAT in the workflow (the job token is read-only).
  Locally: `DRY_RUN=1 GH_REPO=<owner>/<repo> node packages/factory/src/dispatch/dispatch.ts`.
- **The frontier is only as good as the labels.** `ready-for-human` and `agent:blocked` issues are
  passed over; a manual `gh workflow run factory-implement.yml -f issue=<n>` is the override and
  removes both labels itself.
