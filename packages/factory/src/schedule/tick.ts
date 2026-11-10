/**
 * The factory's tick: dispatches every nightly or weekly job that is due and
 * has no tick dispatch since it fell due, so a late or dropped GitHub schedule
 * is caught up by the next one. `due.ts` holds the schedule and the rule; this
 * script only reads the runs and starts the workflows.
 *
 * Only the tick's own dispatch counts. It dispatches with `scheduled=true` and
 * every workflow puts the `(factory tick)` marker in its run name, which the
 * runs API exposes as `display_title`; a manual, dry or per-pull-request run
 * therefore never suppresses the scheduled one.
 *
 * A failed run read or dispatch is collected and the other due jobs still go
 * out; the tick then fails so the error is visible. A dispatch that did land
 * counts even if its job fails, so a broken job is not retried in a loop.
 *
 * Env: GH_REPO, GH_TOKEN (the PAT, in the workflow), DRY_RUN.
 */
import { dueJobs, JOBS, lastDueAt } from "#schedule/due.ts";
import { fail, required, sh } from "#shared/common.ts";

/** The run-name suffix every tick dispatch carries; see the five workflows. */
export const TICK_MARKER = "(factory tick)";

/** The REST run fields the tick reads. */
interface ApiRun {
  readonly created_at?: string;
  readonly display_title?: string;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** The newest tick dispatch in `runs`, if the page holds one with a readable time. */
export const newestTickRun = (runs: readonly ApiRun[]): Date | undefined => {
  const times = runs
    .filter((run) => run.display_title?.includes(TICK_MARKER) === true)
    .map((run) => Date.parse(run.created_at ?? ""))
    .filter((time) => Number.isFinite(time));
  return times.length === 0 ? undefined : new Date(Math.max(...times));
};

/** The newest tick dispatch of `workflow` created at or after `since`. */
const tickRunSince = (repo: string, workflow: string, since: Date): Date | undefined => {
  const runs: unknown = JSON.parse(
    sh(
      `gh api "repos/${repo}/actions/workflows/${workflow}/runs?event=workflow_dispatch&created=${encodeURIComponent(
        `>=${since.toISOString()}`,
      )}&per_page=100" --jq '.workflow_runs'`,
    ),
  );
  if (!Array.isArray(runs)) throw new Error(`The runs page for ${workflow} is not an array.`);
  return newestTickRun(runs as readonly ApiRun[]);
};

export interface TickDeps {
  readonly now: Date;
  readonly dryRun: boolean;
  /** The newest run that counts as the job's scheduled run; only the tick's own dispatch does. */
  readonly lastTickRun: (workflow: string, since: Date) => Date | undefined;
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

/** One tick: read every job's runs, dispatch the due ones, and keep a failed call from blocking the rest. */
export const runTick = ({ now, dryRun, lastTickRun, dispatch, log }: TickDeps): TickOutcome => {
  const dueAt = new Map<string, Date>();
  const lastRunAt = new Map<string, Date | undefined>();
  const errors: string[] = [];

  for (const job of JOBS) {
    try {
      const occurrence = lastDueAt(job, now);
      dueAt.set(job.workflow, occurrence);
      lastRunAt.set(job.workflow, lastTickRun(job.workflow, occurrence));
    } catch (error) {
      errors.push(`${job.name}: could not read its runs: ${messageOf(error)}`);
    }
  }

  const due: string[] = [];
  const dispatched: string[] = [];
  for (const job of dueJobs(now, (workflow) => lastRunAt.get(workflow))) {
    const occurrence = dueAt.get(job.workflow);
    // A failed read leaves no entry: without its runs the tick must not
    // dispatch and risk a second run.
    if (occurrence === undefined || !lastRunAt.has(job.workflow)) continue;
    due.push(job.workflow);
    if (dryRun) {
      log(`Dry run: would dispatch ${job.workflow}; due ${occurrence.toISOString()}.`);
      continue;
    }
    try {
      dispatch(job.workflow);
      dispatched.push(job.workflow);
      log(`Dispatched ${job.workflow}; due ${occurrence.toISOString()}.`);
    } catch (error) {
      errors.push(`${job.name}: could not dispatch: ${messageOf(error)}`);
    }
  }

  return { due, dispatched, errors };
};

const main = (): void => {
  const repo = required("GH_REPO");
  const now = new Date();
  const dryRun = process.env["DRY_RUN"] === "1";

  console.log(`Factory tick — ${now.toISOString()}`);
  const outcome = runTick({
    now,
    dryRun,
    lastTickRun: (workflow, since) => tickRunSince(repo, workflow, since),
    dispatch: (workflow) => {
      sh(`gh workflow run ${workflow} --ref main -f scheduled=true`);
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
    fail(messageOf(error));
  }
}
