/**
 * The monthly minutes budget: the free private plan's 2000 Actions minutes are
 * shared with CI, so the factory counts its own. Pure arithmetic — the
 * dispatcher fetches the runs and their jobs.
 */

/** The factory's share of the plan's minutes, unless the repo overrides it. */
export const DEFAULT_MONTHLY_MINUTES = 1400;

/**
 * The month's cap from `FACTORY_MONTHLY_MINUTES`, or `undefined` for `off`.
 * A public repository's minutes are free, and counting them costs one API
 * call per factory run of the month on every dispatch: enough to exhaust the
 * token's hourly rate limit.
 */
export const budgetLimit = (raw: string | undefined): number | undefined => {
  if (raw?.trim().toLowerCase() === "off") return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MONTHLY_MINUTES;
};

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

/** The first of next month, UTC: when the budget resets. */
const monthAfter = (month: string): string => {
  const start = new Date(month);
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
    .toISOString()
    .slice(0, 10);
};

export interface BudgetNotice {
  /** The hidden marker that keeps the notice to one per month. */
  marker: string;
  /** The title of the report issue, when there is none to comment on yet. */
  title: string;
  body: string;
}

/** What the dispatcher posts once the month's minutes are spent. */
export const budgetNotice = (used: number, limit: number, month: string): BudgetNotice => {
  const period = month.slice(0, 7);
  const marker = `<!-- factory:budget:${period} -->`;
  const body = [
    `The factory's monthly Actions budget is spent: **${String(used)} of ${String(limit)} minutes** used in ${period}.`,
    "",
    `No implementer is dispatched until ${monthAfter(month)}. Raise the repository variable`,
    "`FACTORY_MONTHLY_MINUTES` if this month needs more minutes than that.",
    "",
    marker,
  ].join("\n");
  return { marker, title: `Factory report — ${period}`, body };
};
