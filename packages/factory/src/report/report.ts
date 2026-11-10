/**
 * The factory's weekly health report: the owner's single weekly glance. It
 * reads the Budapest week that just ended — tickets merged, blocked, fix
 * rounds, auto vs human merges, idea-to-merge, minutes, Claude and omp runs,
 * the retro log — and posts it as a `factory:report` issue. The new issue is
 * written before last week's is closed: the dispatcher comments its budget
 * notice on the newest open report issue. `DRY_RUN=1` prints the body.
 *
 * A scheduled run only acts at 06:00 Budapest; the workflow schedules both
 * UTC hours that land there, one per side of the DST switch. `workflow_dispatch`
 * always runs.
 *
 * Env: GH_REPO, EVENT_NAME, FACTORY_MONTHLY_MINUTES, DRY_RUN.
 */
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { budgetLimit, minutesUsed, monthStart } from "#dispatch/budget.ts";
import {
  autoMergeOf,
  fixRoundsOf,
  linesAdded,
  needsYouOf,
  reportMetrics,
  type MergedPullFacts,
  type NeedsYouItem,
  type RunFacts,
} from "#report/metrics.ts";
import {
  REPORT_LABEL,
  reportPlan,
  reportTitle,
  type ReportIssue,
  type ReportPlan,
} from "#report/issue.ts";
import { reportBody } from "#report/render.ts";
import { inWindow, REPORT_HOUR, scheduleSlot, type WeekWindow, weekWindow } from "#report/week.ts";
import { api, issueComments } from "#shared/github.ts";
import { closingIssues } from "#shared/closing-pr.ts";
import { fail, required, safeSh, sh } from "#shared/common.ts";
import { factoryRuns, type FactoryRun } from "#shared/runs.ts";
import { budapestHour } from "#shared/budapest.ts";

/**
 * The workflow files whose runs are Claude Code's judgement work. Keyed by
 * path: the REST `name` is the workflow's `run-name` (`Factory review #97`),
 * not its `name:`, so matching names would silently count nothing.
 */
const CLAUDE_WORKFLOWS: Record<string, true> = {
  ".github/workflows/factory-review.yml": true,
  ".github/workflows/factory-intake.yml": true,
  ".github/workflows/factory-retro.yml": true,
};

/** The workflow files whose runs are omp's token-heavy work. */
const OMP_WORKFLOWS: Record<string, true> = {
  ".github/workflows/factory-implement.yml": true,
  ".github/workflows/factory-fix.yml": true,
};

const BLOCKED_LABEL = "agent:blocked";
const RETRO_LOG = "docs/agents/factory-log.md";

/** The fields of the REST responses the report reads. */
interface ApiIssue {
  number: number;
  title: string;
  html_url: string;
  created_at: string;
  body: string | null;
  labels: { name: string }[];
  pull_request?: unknown;
}

interface ApiSearchPull {
  number: number;
  title: string;
  html_url: string;
  body: string | null;
  pull_request?: { merged_at: string | null };
}

/** A page of the search API; unlike the REST list endpoints it wraps `items`. */
interface SearchPage {
  items: ApiSearchPull[];
}

interface ApiTimelineEvent {
  event: string;
  created_at?: string;
  label?: { name: string };
}

/** The merged ticket pulls of the week: closes an issue, so it has a merge story. */
const mergedPulls = (repo: string, week: WeekWindow): MergedPullFacts[] => {
  // Search dates are UTC days; the exact window filter below is Budapest time.
  const from = new Date(week.start.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const query = encodeURIComponent(`repo:${repo} is:pr is:merged merged:>=${from}`);
  const issues = new Map<number, ApiIssue>();
  const comments = new Map<number, string[]>();

  const issueOf = (number: number): ApiIssue => {
    const cached = issues.get(number);
    if (cached !== undefined) return cached;
    const fetched = api<ApiIssue>(`repos/${repo}/issues/${String(number)}`)[0];
    if (fetched === undefined) throw new Error(`Issue #${String(number)} was not found.`);
    issues.set(number, fetched);
    return fetched;
  };
  const commentsOf = (number: number): string[] => {
    const cached = comments.get(number);
    if (cached !== undefined) return cached;
    const bodies = issueComments(repo, String(number)).map((comment) => comment.body);
    comments.set(number, bodies);
    return bodies;
  };

  return api<SearchPage>(`search/issues?q=${query}&per_page=100`)
    .flatMap((page) => page.items)
    .flatMap((pull) => {
      const mergedAt = pull.pull_request?.merged_at;
      if (mergedAt === null || mergedAt === undefined || !inWindow(mergedAt, week)) return [];
      const closes = closingIssues(pull.body).map((number) => ({
        number,
        createdAt: issueOf(number).created_at,
      }));
      if (closes.length === 0) return [];
      return [
        {
          number: pull.number,
          title: pull.title,
          url: pull.html_url,
          mergedAt,
          closes,
          fixRounds: fixRoundsOf(commentsOf(pull.number)),
          // #87's gate comments `Merged in <sha>.` on the closing issue after an
          // auto-merge; its escalation marker on the pull request means a person
          // merged it instead.
          auto: autoMergeOf(
            commentsOf(pull.number),
            closes.flatMap((issue) => commentsOf(issue.number)),
          ),
        },
      ];
    });
};

/** The blocked issues: open now, plus those that got the label this week. */
const blockedFacts = (repo: string, week: WeekWindow): { open: number[]; thisWeek: number[] } => {
  const open = api<ApiIssue>(
    `repos/${repo}/issues?state=open&labels=${encodeURIComponent(BLOCKED_LABEL)}&per_page=100`,
  )
    .filter((issue) => issue.pull_request === undefined)
    .map((issue) => issue.number);

  const updated = api<ApiIssue>(
    `repos/${repo}/issues?state=all&since=${encodeURIComponent(week.start.toISOString())}&per_page=100`,
  ).filter((issue) => issue.pull_request === undefined);
  const thisWeek = updated
    .filter((issue) =>
      api<ApiTimelineEvent>(
        `repos/${repo}/issues/${String(issue.number)}/timeline?per_page=100`,
      ).some(
        (event) =>
          event.event === "labeled" &&
          event.label?.name === BLOCKED_LABEL &&
          inWindow(event.created_at ?? null, week),
      ),
    )
    .map((issue) => issue.number);

  return { open, thisWeek };
};

/** The owner's queue: open `ready-for-human` issues and pulls, and spec drafts. */
const needsYou = (repo: string): NeedsYouItem[] => {
  const byLabel = (label: string): NeedsYouItem[] =>
    api<ApiIssue>(
      `repos/${repo}/issues?state=open&labels=${encodeURIComponent(label)}&per_page=100`,
    ).map((issue) => ({
      number: issue.number,
      title: issue.title,
      url: issue.html_url,
      createdAt: issue.created_at,
      labels: issue.labels.map((entry) => entry.name),
    }));
  return needsYouOf([...byLabel("ready-for-human"), ...byLabel("spec:proposed")]);
};

const runFacts = (run: FactoryRun): RunFacts => ({
  createdAt: run.createdAt,
  startedAt: run.startedAt,
});

/** The week's runs, split into Claude's and omp's by workflow name. */
const agentRuns = (
  runs: readonly FactoryRun[],
  week: WeekWindow,
): { claudeRuns: RunFacts[]; ompRuns: RunFacts[] } => {
  const started = runs.filter((run) => inWindow(run.startedAt ?? run.createdAt, week));
  return {
    claudeRuns: started.filter((run) => CLAUDE_WORKFLOWS[run.path] === true).map(runFacts),
    ompRuns: started.filter((run) => OMP_WORKFLOWS[run.path] === true).map(runFacts),
  };
};

/**
 * Lines added to the retro log in the week; `null` while #90 has not written
 * it yet, which the report shows as "none yet".
 */
const retroLines = (week: WeekWindow): number | null => {
  const root = join(import.meta.dirname, "../../../..");
  if (!existsSync(join(root, RETRO_LOG))) return null;
  return linesAdded(
    safeSh(
      `git -C "${root}" log --since="${week.start.toISOString()}" --until="${week.end.toISOString()}" --numstat --format= -- "${RETRO_LOG}"`,
    ),
  );
};

/** The write side: open or edit this week's issue, then close the older weekly ones. */
const writeReport = (title: string, bodyText: string, plan: ReportPlan, dryRun: boolean): void => {
  const closes = plan.closes.map((number) => `#${String(number)}`).join(", ") || "nothing";
  if (dryRun) {
    console.log(bodyText);
    const action =
      plan.action === "create" ? "open a new report issue" : `edit #${String(plan.number)}`;
    console.log(`Dry run: would ${action} and close ${closes}.`);
    return;
  }

  const file = join(mkdtempSync(join(tmpdir(), "factory-report-")), "report.md");
  writeFileSync(file, bodyText);

  if (plan.action === "create") {
    const url = sh(
      `gh issue create --title "${title}" --body-file "${file}" --label ${REPORT_LABEL}`,
    ).trim();
    const number = /(\d+)\s*$/u.exec(url)?.[1];
    if (number === undefined)
      throw new Error(`Could not read the new issue's number from '${url}'.`);
    console.log(`Opened "${title}": ${url}`);
    for (const previous of plan.closes) {
      sh(`gh issue close ${String(previous)} --comment "Superseded by #${number}."`);
      console.log(`Closed #${String(previous)}.`);
    }
    return;
  }

  sh(`gh issue edit ${String(plan.number)} --title "${title}" --body-file "${file}"`);
  console.log(`Updated #${String(plan.number)}.`);
  for (const previous of plan.closes) {
    sh(`gh issue close ${String(previous)} --comment "Superseded by #${String(plan.number)}."`);
    console.log(`Closed #${String(previous)}.`);
  }
};

const main = (): void => {
  const now = new Date();
  if (process.env["EVENT_NAME"] === "schedule" && !scheduleSlot(now)) {
    console.log(
      `Skipping: the Budapest hour is ${String(budapestHour(now))}; the report runs at ${String(REPORT_HOUR)}:00.`,
    );
    return;
  }

  const repo = required("GH_REPO");
  const week = weekWindow(now);
  const month = monthStart(now);
  const monthMs = Date.parse(month);

  console.log(
    `Weekly report — ${week.weekOf} (${week.start.toISOString()} → ${week.end.toISOString()})`,
  );

  // The month starts the dispatcher's budget; the week may start in the month before.
  const since = new Date(Math.min(monthMs, week.start.getTime() - 24 * 60 * 60 * 1000));
  const runs = factoryRuns(repo, since.toISOString());
  const blocked = blockedFacts(repo, week);
  const agents = agentRuns(runs, week);

  const metrics = reportMetrics({
    mergedPulls: mergedPulls(repo, week),
    blockedOpen: blocked.open,
    blockedThisWeek: blocked.thisWeek,
    claudeRuns: agents.claudeRuns,
    ompRuns: agents.ompRuns,
    minutes: {
      month: minutesUsed(
        runs.filter((run) => Date.parse(run.createdAt) >= monthMs).flatMap((run) => run.jobs),
        now,
      ),
      week: minutesUsed(
        runs.filter((run) => inWindow(run.createdAt, week)).flatMap((run) => run.jobs),
        now,
      ),
      // `off` (a public repository) reads as 0: no budget warning.
      limit: budgetLimit(process.env["FACTORY_MONTHLY_MINUTES"]) ?? 0,
    },
    retroLines: retroLines(week),
  });

  const reports = api<ApiIssue>(
    `repos/${repo}/issues?state=open&labels=${encodeURIComponent(REPORT_LABEL)}&per_page=100`,
  )
    .filter((issue) => issue.pull_request === undefined)
    .map((issue): ReportIssue => ({
      number: issue.number,
      title: issue.title,
      body: issue.body,
    }));

  const plan = reportPlan(reports, week.weekOf);
  const body = reportBody({ week, metrics, needsYou: needsYou(repo) });
  writeReport(reportTitle(week.weekOf), body, plan, process.env["DRY_RUN"] === "1");
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
