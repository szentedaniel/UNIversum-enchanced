/**
 * The factory's tick: dispatches every nightly or weekly job that is due and
 * has not run since it fell due, so a late or dropped GitHub schedule is
 * caught up by the next one. `due.ts` holds the schedule and the rule; this
 * script only reads the runs and starts the workflows.
 *
 * Env: GH_REPO, GH_TOKEN (the PAT, in the workflow), DRY_RUN.
 */
import { dueJobs, JOBS, lastDueAt, type Job } from "#schedule/due.ts";
import { fail, required, sh } from "#shared/common.ts";

/** The newest run of `workflow` created at or after `since`, if GitHub holds one. */
const newestRun = (repo: string, workflow: string, since: Date): Date | undefined => {
  const created = sh(
    `gh api "repos/${repo}/actions/workflows/${workflow}/runs?created=${encodeURIComponent(
      `>=${since.toISOString()}`,
    )}&per_page=1" --jq '.workflow_runs[0].created_at // empty'`,
  ).trim();
  if (created === "") return undefined;
  const at = new Date(created);
  return Number.isNaN(at.getTime()) ? undefined : at;
};

interface ScheduledJob {
  readonly job: Job;
  readonly dueAt: Date;
  readonly lastRun: Date | undefined;
}

const main = (): void => {
  const repo = required("GH_REPO");
  const now = new Date();
  const dryRun = process.env["DRY_RUN"] === "1";

  const schedule: ScheduledJob[] = JOBS.map((job) => {
    const dueAt = lastDueAt(job, now);
    return { job, dueAt, lastRun: newestRun(repo, job.workflow, dueAt) };
  });
  const due = new Set(
    dueJobs(
      now,
      (workflow) => schedule.find((entry) => entry.job.workflow === workflow)?.lastRun,
    ).map((job) => job.workflow),
  );

  console.log(`Factory tick — ${now.toISOString()}`);
  if (due.size === 0) {
    console.log("Nothing is due; the next tick checks again.");
    return;
  }
  for (const { job, dueAt } of schedule) {
    if (!due.has(job.workflow)) continue;
    if (dryRun) {
      console.log(`Dry run: would dispatch ${job.workflow}; due ${dueAt.toISOString()}.`);
      continue;
    }
    sh(`gh workflow run ${job.workflow} --ref main`);
    console.log(`Dispatched ${job.workflow}; due ${dueAt.toISOString()}.`);
  }
  if (dryRun) console.log("Dry run: nothing was dispatched.");
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
