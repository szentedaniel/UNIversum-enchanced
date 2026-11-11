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
import {
  frontierOf,
  overlapNote,
  type IssueFacts,
  type OpenPull,
  type SkippedIssue,
} from "#dispatch/frontier.ts";
import { DEFAULT_MAX_PARALLEL, noDispatchReason, planOf } from "#dispatch/plan.ts";
import { api, parseJson } from "#shared/github.ts";
import { fail, positiveInt, required, sh } from "#shared/common.ts";
import { READY_LABEL } from "#shared/labels.ts";
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

interface ApiPull {
  number: number;
  url: string;
  body: string | null;
  headRefName: string;
  files: { path: string }[];
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

const issueFacts = (repo: string, issue: ApiIssue): IssueFacts => {
  const labels = issue.labels.map((label) => label.name);
  return {
    number: issue.number,
    title: issue.title,
    createdAt: issue.created_at,
    labels,
    blockedBy: issue.issue_dependencies_summary.blocked_by,
    openBlockers:
      !labels.includes("ready-for-agent") || issue.issue_dependencies_summary.blocked_by === 0
        ? []
        : openBlockers(repo, issue.number),
    subIssues: issue.sub_issues_summary.total,
    body: issue.body,
  };
};

export const openIssues = (repo: string): IssueFacts[] =>
  api<ApiIssue>(`repos/${repo}/issues?state=open&per_page=100`)
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => issueFacts(repo, issue));

export const openPulls = (repo: string): OpenPull[] =>
  parseJson<ApiPull[]>(
    sh(
      `gh pr list --repo "${repo}" --state open --limit 100 --json number,url,body,headRefName,files`,
    ),
  ).map((pull) => ({
    number: pull.number,
    url: pull.url,
    body: pull.body,
    branch: pull.headRefName,
    files: pull.files.map((file) => file.path),
  }));

const comments = (repo: string, issue: number): string[] =>
  api<{ body: string }>(`repos/${repo}/issues/${String(issue)}/comments?per_page=100`).map(
    (comment) => comment.body,
  );

export interface NoteOverlapDeps {
  /** The tickets the frontier skipped, with the pull request each one overlaps. */
  readonly skipped: readonly SkippedIssue[];
  /** Every comment already on the ticket, for the marker dedupe. */
  readonly readComments: (issue: number) => readonly string[];
  /** Posts the note on the ticket. */
  readonly post: (issue: number, body: string) => void;
}

/**
 * Posts one note per blocked pull request on a ticket that overlaps it. The
 * marker is the dedupe, so the hourly backstop does not repeat the note.
 */
export const noteOverlaps = ({ skipped, readComments, post }: NoteOverlapDeps): void => {
  for (const { issue, blockingPull } of skipped) {
    if (blockingPull === undefined) continue;
    const note = overlapNote(blockingPull);
    if (readComments(issue.number).some((body) => body.includes(note.marker))) continue;
    post(issue.number, note.body);
    console.log(
      `Noted #${String(issue.number)} waits for pull request #${String(blockingPull.number)}.`,
    );
  }
};

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
  const issues = openIssues(repo);
  const frontier = frontierOf(
    issues.filter((issue) => issue.labels.includes(READY_LABEL)),
    openPulls(repo),
    issuesOfRuns(running),
    issues,
  );
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
  if (!dryRun) {
    noteOverlaps({
      skipped: frontier.skipped,
      readComments: (issue) => comments(repo, issue),
      post: (issue, body) => {
        const file = join(mkdtempSync(join(tmpdir(), "factory-overlap-")), "note.md");
        writeFileSync(file, `${body}\n`);
        sh(`gh issue comment ${String(issue)} --body-file "${file}"`);
      },
    });
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

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
