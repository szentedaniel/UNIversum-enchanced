/**
 * The factory's nightly and weekly schedule, in Budapest wall time so a DST
 * switch needs no second slot. Pure: the tick passes its clock and the newest
 * scheduled run it read for each workflow in.
 */
import { NIGHT_END_HOUR } from "#review/window.ts";
import { budapestAt, budapestDay, mondayIndex, shiftDay, type Weekday } from "#shared/budapest.ts";

/** A Budapest wall-clock time, parsed once in the schedule rather than per call. */
export interface Clock {
  readonly hour: number;
  readonly minute: number;
}

/** One job the tick may dispatch. */
export interface Job {
  /** The step's name, as the tick logs it. */
  readonly name: string;
  /** The workflow file `gh workflow run` starts. */
  readonly workflow: string;
  /** When it falls due, Budapest wall time. */
  readonly due: Clock;
  /**
   * The latest Budapest wall time on the due day that may still start a missed
   * run, exclusive; at or after it the job waits for its next due time.
   */
  readonly latestStart: Clock;
  /** The weekdays it falls due, Monday 0 … Sunday 6. */
  readonly days: readonly Weekday[];
}

const EVERY_DAY: readonly Weekday[] = [0, 1, 2, 3, 4, 5, 6];

/** The night window's end is the Claude jobs' latest start. */
const NIGHT_END: Clock = { hour: NIGHT_END_HOUR, minute: 0 };

/** The report may be caught up all Monday. */
const DAY_END: Clock = { hour: 23, minute: 59 };

/**
 * The tick's whole schedule. The latest starts keep the Claude jobs inside the
 * 01:00–07:00 night window; the report may run all Monday.
 */
export const JOBS: readonly Job[] = [
  {
    name: "intake",
    workflow: "factory-intake.yml",
    due: { hour: 1, minute: 7 },
    latestStart: NIGHT_END,
    days: EVERY_DAY,
  },
  {
    name: "review",
    workflow: "factory-review.yml",
    due: { hour: 2, minute: 23 },
    latestStart: NIGHT_END,
    days: EVERY_DAY,
  },
  {
    name: "retro",
    workflow: "factory-retro.yml",
    due: { hour: 4, minute: 41 },
    latestStart: NIGHT_END,
    days: EVERY_DAY,
  },
  {
    name: "maintain",
    workflow: "factory-maintain.yml",
    due: { hour: 3, minute: 19 },
    latestStart: NIGHT_END,
    days: [6],
  },
  {
    name: "report",
    workflow: "factory-report.yml",
    due: { hour: 6, minute: 9 },
    latestStart: DAY_END,
    days: [0],
  },
];

const DAYS_IN_WEEK = 7;

/**
 * The most recent due occurrence at or before `now`, with the Budapest day it
 * falls on. Every job is due at least once a week, so the seven-day walk finds one.
 */
const occurrenceOf = (job: Job, now: Date): { at: Date; day: string } | undefined => {
  const today = budapestDay(now);
  for (let back = 0; back < DAYS_IN_WEEK; back++) {
    const day = shiftDay(today, -back);
    if (!job.days.includes(mondayIndex(day))) continue;
    const at = budapestAt(day, job.due.hour, job.due.minute);
    if (at.getTime() <= now.getTime()) return { at, day };
  }
  return undefined;
};

/**
 * The instant of `job`'s most recent due time: what the tick reads the
 * workflow's runs since. Throws only if a job's schedule has no weekday.
 */
export const lastDueAt = (job: Job, now: Date): Date => {
  const occurrence = occurrenceOf(job, now);
  if (occurrence === undefined) throw new Error(`${job.name} has no weekday in its schedule`);
  return occurrence.at;
};

/**
 * The jobs to dispatch now: the due time has passed, its latest start has not,
 * and no scheduled run was created at or after it. The caller counts only the
 * tick's own dispatch, so a manual, dry or per-workflow run never suppresses
 * the scheduled one; a failed dispatch still counts, so it is not retried in a
 * loop.
 */
export const dueJobs = (now: Date, lastRunAt: (workflow: string) => Date | undefined): Job[] =>
  JOBS.filter((job) => {
    const occurrence = occurrenceOf(job, now);
    if (occurrence === undefined) return false;
    const deadline = budapestAt(occurrence.day, job.latestStart.hour, job.latestStart.minute);
    if (now.getTime() >= deadline.getTime()) return false;
    const lastRun = lastRunAt(job.workflow);
    return lastRun === undefined || lastRun.getTime() < occurrence.at.getTime();
  });
