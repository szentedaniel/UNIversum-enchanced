/**
 * The factory's tick: dispatches every nightly or weekly job that is due and
 * has not run since it fell due, so a late or dropped GitHub schedule is
 * caught up by the next one. `due.ts` holds the schedule and the rule; this
 * script only reads the runs and starts the workflows.
 *
 * Any run of the workflow created at or after the due time counts, whatever
 * its event or conclusion: a manual or per-pull-request run after the due time
 * already did the work, and a failed run is not retried in a loop.
 *
 * A failed run read or dispatch is collected and the other due jobs still go
 * out; the tick then fails so the error is visible.
 *
 * Env: GH_REPO, GH_TOKEN (the PAT, in the workflow), DRY_RUN.
 */
import { dueJobs, JOBS } from "#schedule/due.ts";
import { fail, required, sh } from "#shared/common.ts";

/** The job names keyed by workflow file, for the tick's error lines. */
const JOB_NAMES = new Map(JOBS.map((job) => [job.workflow, job.name]));

/** The time in a run's `created_at` string, if GitHub returned a readable one. */
export const runCreatedAt = (created: string): Date | undefined => {
  const trimmed = created.trim();
  if (trimmed === "") return undefined;
  const at = new Date(trimmed);
  return Number.isNaN(at.getTime()) ? undefined : at;
};

/** The newest run of `workflow` created at or after `since`, if GitHub holds one. */
const newestRun = (repo: string, workflow: string, since: Date): Date | undefined =>
  runCreatedAt(
    sh(
      `gh api "repos/${repo}/actions/workflows/${workflow}/runs?created=${encodeURIComponent(
        `>=${since.toISOString()}`,
      )}&per_page=1" --jq '.workflow_runs[0].created_at // empty'`,
    ),
  );

export interface TickDeps {
  readonly now: Date;
  readonly dryRun: boolean;
  /** The newest run of `workflow` created at or after `dueAt`. */
  readonly lastRun: (workflow: string, dueAt: Date) => Date | undefined;
  readonly dispatch: (workflow: string) => void;
  readonly log: (line: string) => void;
}

export interface TickOutcome {
  /** The workflows found due, whether or not a dry run or a failure stopped them. */
  readonly due: readonly string[];
  readonly dispatched: readonly string[];
  /** One line per failed run read or dispatch; the caller fails the tick with them. */
  readonly errors: readonly string[];
}

/** One tick: read the due jobs' runs, dispatch them, and keep a failed call from blocking the rest. */
export const runTick = ({ now, dryRun, lastRun, dispatch, log }: TickDeps): TickOutcome => {
  const dueAt = new Map<string, Date>();
  const unreadable = new Set<string>();
  const errors: string[] = [];

  const due = dueJobs(now, (workflow, occurrence) => {
    dueAt.set(workflow, occurrence);
    try {
      return lastRun(workflow, occurrence);
    } catch (error) {
      // Without its runs the tick must not dispatch and risk a second run.
      unreadable.add(workflow);
      errors.push(
        `${JOB_NAMES.get(workflow) ?? workflow}: could not read its runs: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }).filter((job) => !unreadable.has(job.workflow));

  const dispatched: string[] = [];
  for (const job of due) {
    const occurrence = dueAt.get(job.workflow);
    // `dueJobs` only returns a job after its callback recorded the occurrence.
    if (occurrence === undefined) continue;
    if (dryRun) {
      log(`Dry run: would dispatch ${job.workflow}; due ${occurrence.toISOString()}.`);
      continue;
    }
    try {
      dispatch(job.workflow);
      dispatched.push(job.workflow);
      log(`Dispatched ${job.workflow}; due ${occurrence.toISOString()}.`);
    } catch (error) {
      errors.push(
        `${job.name}: could not dispatch: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return { due: due.map((job) => job.workflow), dispatched, errors };
};

const main = (): void => {
  const repo = required("GH_REPO");
  const now = new Date();
  const dryRun = process.env["DRY_RUN"] === "1";

  console.log(`Factory tick — ${now.toISOString()}`);
  const outcome = runTick({
    now,
    dryRun,
    lastRun: (workflow, since) => newestRun(repo, workflow, since),
    dispatch: (workflow) => {
      sh(`gh workflow run ${workflow} --ref main`);
    },
    log: console.log,
  });

  if (outcome.errors.length > 0) {
    fail(`The tick hit errors:\n- ${outcome.errors.join("\n- ")}`);
  }
  if (outcome.due.length === 0) {
    console.log("Nothing is due; the next tick checks again.");
  } else if (dryRun) {
    console.log("Dry run: nothing was dispatched.");
  }
};

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
