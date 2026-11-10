/**
 * The factory's dispatcher: reads the frontier, the implementers already
 * queued or running and the month's billed minutes, then dispatches
 * `factory-implement` for as many issues as fit. `DRY_RUN=1` prints the plan
 * and writes nothing.
 *
 * Env: GH_REPO (owner/name), GH_TOKEN (the PAT, in the workflow), DRY_RUN,
 * FACTORY_MONTHLY_MINUTES, FACTORY_MAX_PARALLEL.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetNotice, budgetLimit, minutesUsed, monthStart } from "#dispatch/budget.ts";
import { frontierOf, type IssueFacts } from "#dispatch/frontier.ts";
import { DEFAULT_MAX_PARALLEL, noDispatchReason, planOf } from "#dispatch/plan.ts";
import { api } from "#shared/github.ts";
import type { PullFacts } from "#shared/closing-pr.ts";
import { fail, positiveInt, required, sh } from "#shared/common.ts";
import { factoryRuns } from "#shared/runs.ts";

/** The fields of the REST responses the dispatcher reads. */
interface ApiIssue {
  number: number;
  title: string;
  created_at: string;
  body: string | null;
  labels: { name: string }[];
  pull_request?: unknown;
  issue_dependencies_summary: { blocked_by: number };
  sub_issues_summary: { total: number };
}

interface ApiRun {
  id: number;
  name: string;
  path: string;
  status: string;
}

interface RunsPage {
  workflow_runs: ApiRun[];
}

const RUNNING_STATUSES: Record<string, true> = { queued: true, in_progress: true };

const runningImplementers = (repo: string): ApiRun[] =>
  api<RunsPage>(`repos/${repo}/actions/workflows/factory-implement.yml/runs?per_page=100`)
    .flatMap((page) => page.workflow_runs)
    .filter((run) => RUNNING_STATUSES[run.status] === true);

/**
 * The issues the running runs already cover. `run-name` is
 * `Factory implement #<n>`; a name without a number still counts as a running
 * implementer, it just cannot claim an issue.
 */
const issuesOfRuns = (runs: readonly ApiRun[]): Set<number> =>
  new Set(
    runs.flatMap((run) => {
      const digits = /#(\d+)/u.exec(run.name)?.[1];
      return digits === undefined ? [] : [Number(digits)];
    }),
  );

const openBlockers = (repo: string, issue: number): number[] =>
  api<{ number: number; state: string }>(
    `repos/${repo}/issues/${String(issue)}/dependencies/blocked_by?per_page=100`,
  )
    .filter((blocker) => blocker.state === "open")
    .map((blocker) => blocker.number);

const candidates = (repo: string): IssueFacts[] =>
  api<ApiIssue>(`repos/${repo}/issues?state=open&labels=ready-for-agent&per_page=100`)
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => ({
      number: issue.number,
      title: issue.title,
      createdAt: issue.created_at,
      labels: issue.labels.map((label) => label.name),
      blockedBy: issue.issue_dependencies_summary.blocked_by,
      openBlockers:
        issue.issue_dependencies_summary.blocked_by === 0 ? [] : openBlockers(repo, issue.number),
      subIssues: issue.sub_issues_summary.total,
    }));

const openPulls = (repo: string): PullFacts[] =>
  api<{ html_url: string; body: string | null }>(`repos/${repo}/pulls?state=open&per_page=100`).map(
    (pull) => ({ url: pull.html_url, body: pull.body }),
  );

const comments = (repo: string, issue: number): string[] =>
  api<{ body: string }>(`repos/${repo}/issues/${String(issue)}/comments?per_page=100`).map(
    (comment) => comment.body,
  );

/**
 * Posts the budget notice once per month: on the newest open `factory:report`
 * issue, or on a fresh one when the weekly report has not opened one yet. The
 * hidden marker is the dedupe.
 */
const announceBudget = (repo: string, used: number, limit: number, month: string): void => {
  const notice = budgetNotice(used, limit, month);
  const reports = api<ApiIssue>(
    `repos/${repo}/issues?state=open&labels=${encodeURIComponent("factory:report")}&sort=created&direction=desc&per_page=100`,
  ).filter((issue) => issue.pull_request === undefined);

  const posted = reports.some((report) =>
    [report.body ?? "", ...comments(repo, report.number)].some((text) =>
      text.includes(notice.marker),
    ),
  );
  if (posted) {
    console.log(`The ${notice.title} budget notice is already on a report issue.`);
    return;
  }

  const file = join(mkdtempSync(join(tmpdir(), "factory-dispatch-")), "budget.md");
  writeFileSync(file, `${notice.body}\n`);

  const newest = reports[0];
  if (newest === undefined) {
    sh(`gh issue create --title "${notice.title}" --body-file "${file}" --label factory:report`);
    console.log(`Opened "${notice.title}" with the budget notice.`);
  } else {
    sh(`gh issue comment ${String(newest.number)} --body-file "${file}"`);
    console.log(`Posted the budget notice on #${String(newest.number)}.`);
  }
};

const dispatch = (issue: IssueFacts): void => {
  console.log(`Dispatching #${String(issue.number)}: ${issue.title}`);
  sh(`gh workflow run factory-implement.yml -f issue=${String(issue.number)}`);
};

const main = (): void => {
  const repo = required("GH_REPO");
  const now = new Date();
  const dryRun = process.env["DRY_RUN"] === "1";
  const limit = budgetLimit(process.env["FACTORY_MONTHLY_MINUTES"]);
  const maxParallel = positiveInt(process.env["FACTORY_MAX_PARALLEL"], DEFAULT_MAX_PARALLEL);

  const month = monthStart(now);
  const used =
    limit === undefined
      ? 0
      : minutesUsed(
          factoryRuns(repo, month).flatMap((run) => run.jobs),
          now,
        );
  const running = runningImplementers(repo);
  const frontier = frontierOf(candidates(repo), openPulls(repo), issuesOfRuns(running));
  const plan = planOf(frontier.eligible, running.length, maxParallel);
  const spent = limit !== undefined && used >= limit;

  console.log(`Factory dispatch — ${now.toISOString()}`);
  console.log(
    limit === undefined
      ? "Budget: off (FACTORY_MONTHLY_MINUTES=off)"
      : `Budget: ${String(used)} of ${String(limit)} minutes since ${month}`,
  );
  console.log(
    `Implementers: ${String(running.length)} of ${String(maxParallel)} queued or running`,
  );
  console.log(`Frontier (${String(frontier.eligible.length)}):`);
  for (const issue of frontier.eligible) console.log(`  #${String(issue.number)} ${issue.title}`);
  if (frontier.skipped.length > 0) {
    console.log(`Skipped (${String(frontier.skipped.length)}):`);
    for (const { issue, reason } of frontier.skipped) {
      console.log(`  #${String(issue.number)} ${issue.title} — ${reason}`);
    }
  }

  if (spent) {
    console.log(`Dispatch: none — the ${month.slice(0, 7)} budget is spent.`);
    if (!dryRun && limit !== undefined) announceBudget(repo, used, limit, month);
    return;
  }
  if (plan.dispatch.length === 0) {
    console.log(noDispatchReason(frontier.eligible, running.length, maxParallel));
    return;
  }

  const numbers = plan.dispatch.map((issue) => `#${String(issue.number)}`).join(", ");
  console.log(`Dispatch: ${numbers}`);
  if (plan.waiting.length > 0) {
    const waiting = plan.waiting.map((issue) => `#${String(issue.number)}`).join(", ");
    console.log(`Waiting for a slot: ${waiting}`);
  }
  if (dryRun) {
    console.log("Dry run: nothing was dispatched.");
    return;
  }
  for (const issue of plan.dispatch) dispatch(issue);
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
