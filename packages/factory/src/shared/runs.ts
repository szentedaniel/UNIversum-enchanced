/**
 * The factory's workflow runs, with the jobs each billed: the dispatcher sums
 * them for the monthly budget, the weekly report also splits them by week and
 * by agent. The run scripts read a run's log through `runLog` here too, so the
 * `gh run view` command, its buffer and its partial-stdout salvage live once.
 */
import { execSync } from "node:child_process";
import { isFactoryWorkflow, type JobTiming } from "#dispatch/budget.ts";
import { api } from "#shared/github.ts";

interface ApiRun {
  id: number;
  name: string;
  path: string;
  created_at: string;
  run_started_at: string | null;
}

interface RunsPage {
  workflow_runs: ApiRun[];
}

interface JobsPage {
  jobs: { started_at: string | null; completed_at: string | null }[];
}

export interface FactoryRun {
  readonly id: number;
  readonly name: string;
  readonly path: string;
  readonly createdAt: string;
  /** Null while the run is queued; `createdAt` is the fallback for a clock. */
  readonly startedAt: string | null;
  readonly jobs: readonly JobTiming[];
}

/** Every `factory-*.yml` run created since `since` (an ISO instant), with its jobs. */
export const factoryRuns = (repo: string, since: string): FactoryRun[] =>
  api<RunsPage>(
    `repos/${repo}/actions/runs?created=${encodeURIComponent(`>=${since}`)}&per_page=100`,
  )
    .flatMap((page) => page.workflow_runs)
    .filter((run) => isFactoryWorkflow(run.path))
    .map((run) => ({
      id: run.id,
      name: run.name,
      path: run.path,
      createdAt: run.created_at,
      startedAt: run.run_started_at,
      jobs: api<JobsPage>(`repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100`)
        .flatMap((page) => page.jobs)
        .map((job) => ({ startedAt: job.started_at, completedAt: job.completed_at })),
    }));

/**
 * A whole run's log can run to hundreds of megabytes: execSync's 1 MB default
 * overflowed once already (`ENOBUFS`), so the cap is explicit.
 */
const LOG_MAX_BUFFER = 128 * 1024 * 1024;

/** `gh` printing into a string, with room for the log; the seam a test replaces. */
const execLog = (command: string): string =>
  execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: LOG_MAX_BUFFER,
  });

/** The text `gh` printed before it exited non-zero, when it printed any. */
const stdoutOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "stdout" in error) {
    const { stdout } = error;
    if (typeof stdout === "string") return stdout;
  }
  return "";
};

/**
 * A run's log: `--log-failed` keeps a red main's issue to the failed steps,
 * while the flaky pass needs every step's output. GitHub prunes old logs, and
 * `gh` can fail after printing part of one; the part it printed is still the
 * caller's log, and an empty string when it printed nothing.
 */
export const runLog = (
  repo: string,
  runId: string | number,
  { failedOnly }: { readonly failedOnly: boolean },
  exec: (command: string) => string = execLog,
): string => {
  const flag = failedOnly ? "--log-failed" : "--log";
  try {
    return exec(`gh run view ${String(runId)} --repo "${repo}" ${flag}`);
  } catch (error) {
    return stdoutOf(error);
  }
};
