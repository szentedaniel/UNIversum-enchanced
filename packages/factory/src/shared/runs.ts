/**
 * The factory's workflow runs, with the jobs each billed: the dispatcher sums
 * them for the monthly budget, the weekly report also splits them by week and
 * by agent.
 */
import { isFactoryWorkflow, type JobTiming } from "#dispatch/budget.ts";
import { api } from "#shared/api.ts";

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
