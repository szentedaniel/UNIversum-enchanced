/**
 * The factory's tick: dispatches every nightly or weekly job that is due and
 * has no tick dispatch since it fell due, so a late or dropped GitHub schedule
 * is caught up by the next one. The heartbeat (`heartbeat-run.ts`) runs it
 * every ten minutes; the cadence itself lives in `heartbeat.ts`. `due.ts` holds
 * the schedule and the rule, and this script only reads the runs and starts the
 * workflows.
 *
 * Every tick also starts the dispatcher (`factory-dispatch.yml`), so free
 * implementer slots fill within ten minutes of a review finishing, a pull
 * request leaving the gate or an issue being unblocked, instead of waiting for
 * an event or the dispatcher's hourly backstop. The dispatcher is not a
 * scheduled job: it is not in `JOBS`, its start carries no `scheduled` input and
 * its run gets no `(factory tick)` marker, so a dispatch can neither stand in
 * for a nightly job nor suppress one. A dispatch run already queued or in
 * progress is left alone: its concurrency group would queue a second one behind
 * it, and the dispatch the tick wanted is already on its way.
 *
 * Only the tick's own dispatch of a nightly job counts. It dispatches with
 * `scheduled=true` and every workflow puts the `(factory tick)` marker in its
 * run name, which the runs API exposes as `display_title`; a manual, dry or
 * per-pull-request run therefore never suppresses the scheduled one.
 *
 * A failed run read or dispatch is collected and the other due jobs still go
 * out; the tick then fails so the error is visible. A dispatch that did land
 * counts even if its job fails, so a broken job is not retried in a loop.
 *
 * After the dispatcher the tick runs the stuck-pull-request sweep
 * (`sweep.ts`): it nudges an open factory pull request that GitHub left with
 * no CI run, no review or no merge decision, and hands one a nudge did not
 * help to a person. It runs last, and a failed sweep is collected like every
 * other failure, so it cannot hold back a due job or the dispatcher.
 *
 * Env: GH_REPO, GH_TOKEN (the PAT, in the workflow), DRY_RUN.
 */
import { dueJobs, JOBS, lastDueAt } from "#schedule/due.ts";
import { LIVE_STATUSES } from "#schedule/heartbeat.ts";
import { runSweep, sweepWiring } from "#schedule/sweep.ts";
import { fail, GH_CALL_TIMEOUT_MS, required, sh } from "#shared/common.ts";

/** The run-name suffix every tick dispatch carries; see the five workflows. */
export const TICK_MARKER = "(factory tick)";

/** The dispatcher the tick starts on every run; it declares no inputs, so its start passes none. */
const DISPATCH_WORKFLOW = "factory-dispatch.yml";

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
      GH_CALL_TIMEOUT_MS,
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
  /** True while a `factory-dispatch.yml` run is queued or in progress. */
  readonly dispatcherLive: () => boolean;
  /** Starts `factory-dispatch.yml`; throws when the dispatch is refused. */
  readonly startDispatcher: () => void;
  readonly dispatch: (workflow: string) => void;
  /** The sweep's per-pull-request errors; it writes through its own wiring. */
  readonly sweep: (now: Date, dryRun: boolean, log: (line: string) => void) => readonly string[];
  readonly log: (line: string) => void;
}

export interface TickOutcome {
  /** The workflows found due, whether or not a dry run or a failure stopped them. */
  readonly due: readonly string[];
  readonly dispatched: readonly string[];
  /** One line per failed run read or dispatch; the caller fails the tick with them. */
  readonly errors: readonly string[];
}

/** One tick: read every job's runs, dispatch the due ones and the dispatcher, and keep a failed call from blocking the rest. */
export const runTick = ({
  now,
  dryRun,
  lastTickRun,
  dispatcherLive,
  startDispatcher,
  dispatch,
  sweep,
  log,
}: TickDeps): TickOutcome => {
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

  // The dispatcher fills the free slots; the nightly jobs above are one-offs.
  let live: boolean | undefined;
  try {
    live = dispatcherLive();
  } catch (error) {
    errors.push(`dispatcher: could not read its runs: ${messageOf(error)}`);
  }
  // A failed read cannot rule out a live dispatch, so this tick starts none and
  // the next one tries again; a live run has the dispatch on its way already.
  if (live === true) {
    log(`A ${DISPATCH_WORKFLOW} run is queued or running; the tick starts no second one.`);
  } else if (live === false && dryRun) {
    log(`Dry run: would dispatch ${DISPATCH_WORKFLOW}.`);
  } else if (live === false) {
    try {
      startDispatcher();
      log(`Dispatched ${DISPATCH_WORKFLOW}; free slots fill within ten minutes.`);
    } catch (error) {
      errors.push(`dispatcher: could not dispatch: ${messageOf(error)}`);
    }
  }

  // The sweep nudges pull requests stuck with no CI, no review or no merge
  // decision. It runs after every job above, and its own failure is collected,
  // so neither the nightly jobs nor the dispatcher can be held back by it.
  try {
    errors.push(...sweep(now, dryRun, log).map((error) => `sweep: ${error}`));
  } catch (error) {
    errors.push(`sweep: ${messageOf(error)}`);
  }

  return { due, dispatched, errors };
};

/**
 * One page of the dispatcher's runs in `status`: the runs API filters by a
 * single status, so the live statuses need one read each.
 */
const dispatchRunsIn = (repo: string, status: string): readonly unknown[] => {
  const runs: unknown = JSON.parse(
    sh(
      `gh api "repos/${repo}/actions/workflows/${DISPATCH_WORKFLOW}/runs?status=${status}&per_page=100" --jq '.workflow_runs'`,
      GH_CALL_TIMEOUT_MS,
    ),
  );
  if (!Array.isArray(runs)) throw new Error(`The ${status} dispatch runs page is not an array.`);
  return runs;
};

/** True while a `factory-dispatch.yml` run is queued or in progress. */
const dispatchIsLive = (repo: string): boolean =>
  LIVE_STATUSES.some((status) => dispatchRunsIn(repo, status).length > 0);

/** The real wiring the tick and the heartbeat share: the runs API reads and a PAT dispatch. */
export const tickWiring = (
  repo: string,
): Pick<TickDeps, "lastTickRun" | "dispatch" | "dispatcherLive" | "startDispatcher" | "sweep"> => ({
  lastTickRun: (workflow, since) => tickRunSince(repo, workflow, since),
  dispatch: (workflow) => {
    sh(`gh workflow run ${workflow} --ref main -f scheduled=true`, GH_CALL_TIMEOUT_MS);
  },
  dispatcherLive: () => dispatchIsLive(repo),
  sweep: (now, dryRun, log) => runSweep({ now, dryRun, ...sweepWiring(repo), log }),
  startDispatcher: () => {
    sh(`gh workflow run ${DISPATCH_WORKFLOW} --ref main`, GH_CALL_TIMEOUT_MS);
  },
});

const main = (): void => {
  const repo = required("GH_REPO");
  const now = new Date();
  const dryRun = process.env["DRY_RUN"] === "1";

  console.log(`Factory tick — ${now.toISOString()}`);
  const outcome = runTick({
    now,
    dryRun,
    ...tickWiring(repo),
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
