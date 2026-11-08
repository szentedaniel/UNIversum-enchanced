/**
 * The monthly minutes budget: the free private plan's 2000 Actions minutes are
 * shared with CI, so the factory counts its own. Pure arithmetic — the
 * dispatcher fetches the runs and their jobs.
 */

/** The factory's share of the plan's minutes, unless the repo overrides it. */
export const DEFAULT_MONTHLY_MINUTES = 1400;

/** The timing fields of a jobs-API entry. */
export interface JobTiming {
  startedAt: string | null;
  completedAt: string | null;
}

/**
 * GitHub bills a job in whole minutes, rounded up; a job still running counts
 * up to `now`, and one that never started counts nothing.
 */
export const jobMinutes = (job: JobTiming, now: Date): number => {
  if (job.startedAt === null) return 0;
  const start = Date.parse(job.startedAt);
  const end = job.completedAt === null ? now.getTime() : Date.parse(job.completedAt);
  const elapsed = end - start;
  return elapsed <= 0 ? 0 : Math.ceil(elapsed / 60_000);
};

export const minutesUsed = (jobs: readonly JobTiming[], now: Date): number =>
  jobs.reduce((total, job) => total + jobMinutes(job, now), 0);

/** Midnight UTC on the first of `now`'s month: the runs API's `created` filter. */
export const monthStart = (now: Date): string =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();

/** `factory-*.yml`: the factory's workflows, not CI and not a stray file. */
export const isFactoryWorkflow = (path: string): boolean =>
  /^\.github\/workflows\/factory-[^/]+\.ya?ml$/u.test(path);
