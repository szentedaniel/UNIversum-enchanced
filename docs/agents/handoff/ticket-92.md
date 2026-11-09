# Ticket #92 (weekly health report): extension points and gotchas

Branch `ticket/92-health-report`, spec #85. The factory now posts its weekly glance itself: a
`factory:report` issue every Monday at 06:00 Budapest, with the week's numbers, the budget warning and
the owner's queue. Nothing of the game changed.

## The modules (`packages/factory/src/report/`)

- **`week.ts`** — pure. `weekWindow(now)` is the Budapest Monday-to-Monday week that just ended (a run
  later in the week reports the same week), with `weekOf`/`endOf` as `YYYY-MM-DD` and `start`/`end` as
  instants; `scheduleSlot(at)` is true only at 06:00 Budapest (`REPORT_HOUR`); `inWindow(at, week)` is
  half-open `[start, end)` and false for a missing/unreadable time. `budapestHour(at)` was added to
  `src/review/window.ts` beside `budapestDay`.
- **`metrics.ts`** — pure. `reportMetrics(facts)` → `ReportMetrics`: tickets merged (distinct closing
  issues), blocked (union of open `agent:blocked` and got-it-this-week), mean fix rounds, auto/human
  merge split, median idea-to-merge hours, minutes (month/week/limit pass-through), Claude night/day
  counts, omp run count, retro lines. A week with nothing in it is zeros and `null`s, never a throw.
  Helpers the script uses: `fixRoundsOf` (highest `<!-- factory-fix:round N -->` in comment bodies),
  `linesAdded` (`git log --numstat`), `budgetWarning` (80 percent, integer math; "spent" above the
  limit), `needsYouOf` (filters `NEEDS_YOU_LABELS`, one entry per number, oldest first), and
  `autoMergeOf` (reads #87's gate comment; see the gotchas). `MERGE_ESCALATION_MARKER` is the one
  home of `<!-- factory-merge -->`.
- **`issue.ts`** — pure. `reportMarker(weekOf)` = `<!-- factory-report:YYYY-MM-DD -->`,
  `reportTitle(weekOf)` = `Factory report: week of YYYY-MM-DD`, `REPORT_LABEL`, and `reportPlan(open
  issues, weekOf)` → `create` or `edit` plus the older weekly issues to close.
- **`render.ts`** — pure. `reportBody({week, metrics, needsYou})`: the hidden marker, the table, the
  optional `**Budget:**` line, and `## Needs you` as links.

The tests are `test/week.test.ts`, `test/metrics.test.ts`, `test/report-issue.test.ts`,
`test/report-render.test.ts`; `closingIssues` was added to `test/closing-pr.test.ts`.

## The script (`src/report/report.ts`)

- Env: `GH_REPO` (required), `EVENT_NAME`, `DRY_RUN`, `FACTORY_MONTHLY_MINUTES` (`positiveInt`,
  default `DEFAULT_MONTHLY_MINUTES`). With `EVENT_NAME=schedule` and a Budapest hour other than 6 it
  logs and returns 0; a dispatch always runs.
- Reads: merged ticket pulls from `search/issues` (`is:pr is:merged merged:>=<start-1 day>`, then the
  exact `inWindow` filter); each pull's comments for fix rounds and its closing issues' comments for
  the auto-merge marker; blocked issues plus per-issue `timeline` label events; `ready-for-human` and
  `spec:proposed` open items; `factoryRuns` (month and week minutes plus the agent run split); the
  retro log's git history.
- Writes: the new/edited issue first, then `gh issue close <old> --comment "Superseded by #<new>."`.
  `DRY_RUN=1` prints the body and the plan and writes nothing. `GH_TOKEN` is the default
  `GITHUB_TOKEN` (the workflow grants issues write; actions, pull requests, contents read), not the
  PAT: nothing here triggers another workflow.

## The workflow (`.github/workflows/factory-report.yml`)

- Crons `0 4 * * 1` (06:00 CEST) and `0 5 * * 1` (06:00 CET); the script's gate picks one. Manual
  dispatch has `dry_run`. `concurrency: factory-report`, `cancel-in-progress: false`.
- Checkout `main` with `fetch-depth: 0` for `git log --numstat` of the retro log; `setup-node` on
  `.node-version`; no install, no Bun, no agent. `timeout-minutes: 15`.

## The shared reads

- `src/shared/github.ts` — #87's comment readers (`issueComments`, `jsonLines`, `parseJson`) now also
  hold `api<T>(path)`, moved out of `dispatch.ts` unchanged (paginated `gh api --paginate --slurp`, one
  flat list); the report reads its markers through `issueComments`.
- `src/shared/runs.ts` — `factoryRuns(repo, since)` returns the `factory-*.yml` runs created since
  `since`, each with its jobs. The dispatcher now uses it for the month's minutes; the report uses
  the same list for month minutes, week minutes and the agent split.
- `src/shared/closing-pr.ts` — `closingIssues(body)` lists every `closes|fixes|resolves #N`; `closesIssue`
  is now `closingIssues(body).includes(issue)`, and #87's `closingIssue` is `closingIssues(body)[0]`.

## Gotchas later tickets must know

- **The runs API's `name` is the run-name, not the workflow name.** It reads `Factory review #97`,
  `Factory implement #96` (or plain `Factory implement` before #88's quoted `run-name`). The report
  classifies runs by **`.github/workflows/<file>.yml` path**, in `CLAUDE_WORKFLOWS` /
  `OMP_WORKFLOWS` in `report.ts`. Any step that adds a workflow (`factory-intake.yml`,
  `factory-retro.yml`, `factory-fix.yml`) must be added to the right list, or its runs count zero.
- **The search API wraps its results.** A page is `{total_count, items}`, unlike the REST list
  endpoints' bare arrays; `api()` flattens pages, not `items`. `mergedPulls` flatMaps `.items`.
- **The report issue has two shapes.** The dispatcher opens `Factory report — YYYY-MM` (month, used
  for the budget-notice dedupe) and the report opens `Factory report: week of YYYY-MM-DD` (weekly,
  marker in the body). The report closes only titles starting with `Factory report: week of ` and
  leaves the month issue open; it writes the new week's issue **before** closing older ones, so the
  dispatcher's "newest open report issue" still sees the fresh one. If a later step opens a report
  issue, keep the weekly title prefix and the body marker, or the plan will not find it.
- **The auto/human merge split reads #87's real trail, not its escalation marker.** After an
  auto-merge the gate comments `Merged in <sha>.` on the **closing issue**; a person's merge leaves
  no such comment. The gate's `<!-- factory-merge -->` marker is on the **pull request** and means it
  escalated — the ticket context described it the other way round, but #87's merged code is what the
  data shows (`autoMergeOf(pullComments, issueComments)`). Fix rounds come from
  `<!-- factory-fix:round N -->` on the pull request, which matches `src/fix/rounds.ts` exactly; if
  that format changes, `fixRoundsOf` must change with it.
- **#87's marker literals live in two packages.** `MERGE_ESCALATION_MARKER` here mirrors the literal
  in `src/merge/merge.ts`; there is no shared constant across the two steps today.
- **Blocked-this-week is a timeline read.** `repos/.../issues/{n}/timeline` for each issue updated
  since the week start; a label event is `event: "labeled"`, `label.name: "agent:blocked"`. The open
  set is a plain issues query. A week with many updated issues costs one call each; still fine for a
  weekly job.
- **Minutes are per run's `created_at`, by month and by week.** The report's own run is a
  `factory-report.yml` run, so it bills to the month too. The fetch starts at
  `min(monthStart, weekStart - 1 day)` so a week that straddles a month boundary still has its
  numbers while the month total stays the dispatcher's definition.
- **The retro log is optional.** `docs/agents/factory-log.md` absent → `none yet`; present → added
  lines in the window from `git log --numstat`. The checkout needs `fetch-depth: 0`.
- **The handoff note from #88 says the weekly report should comment on the month issue.** This ticket's
  Implementation context overrode that: it opens a weekly issue and leaves the month issue alone. The
  two still work together because the report writes first, closes later.
- **Local check:** `DRY_RUN=1 GH_REPO=<owner>/<repo> node packages/factory/src/report/report.ts`
  does the same reads and prints the body and plan; it is safe (no writes). `EVENT_NAME` unset does
  not skip.
