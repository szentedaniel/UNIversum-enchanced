/**
 * The factory's workflow runs, with the jobs each billed: the dispatcher sums
 * them for the monthly budget, the weekly report also splits them by week and
 * by agent. The one log read lives here too, so the fix loop and the maintenance
 * passes share gh's failure modes: an expired log, an overflowing buffer and
 * the partial stdout an error carries.
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

/** Runs one `gh` command and returns its stdout; a test injects a failing one. */
export type CommandRunner = (command: string) => string;

/** A run log can print far more than execSync's 1 MB default buffer. */
const LOG_MAX_BUFFER = 128 * 1024 * 1024;

const execLog: CommandRunner = (command) =>
  execSync(command, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: LOG_MAX_BUFFER,
  });

/**
 * A run's log, or whatever stdout the failed read captured before the error, or
 * an empty string when GitHub no longer holds it: an expired log is never an
 * error.
 */
export const runLog = (
  repo: string,
  runId: number | string,
  options: { readonly failedOnly: boolean },
  exec: CommandRunner = execLog,
): string => {
  const flag = options.failedOnly ? "--log-failed" : "--log";
  try {
    return exec(`gh run view ${String(runId)} --repo "${repo}" ${flag}`);
  } catch (error) {
    if (typeof error !== "object" || error === null || !("stdout" in error)) return "";
    const { stdout } = error;
    return typeof stdout === "string" ? stdout : "";
  }
};
