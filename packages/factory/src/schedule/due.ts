/**
 * The factory's nightly and weekly schedule, in Budapest wall time so a DST
 * switch needs no second slot. Pure: the tick passes its clock and the newest
 * run it read for each workflow in.
 */
import { budapestAt, budapestDay, mondayIndex, shiftDay } from "#shared/budapest.ts";

/** One job the tick may dispatch. */
export interface Job {
  /** The step's name, as the tick logs it. */
  readonly name: string;
  /** The workflow file `gh workflow run` starts. */
  readonly workflow: string;
  /** When it falls due, Budapest `HH:MM`. */
  readonly due: string;
  /**
   * The latest Budapest `HH:MM` on the due day that may still start a missed
   * run; after it the job waits for its next due time.
   */
  readonly latestStart: string;
  /** The weekdays it falls due, Monday 0 … Sunday 6. */
  readonly days: readonly number[];
}

const EVERY_DAY = [0, 1, 2, 3, 4, 5, 6];

/**
 * The tick's whole schedule. The latest starts keep the Claude jobs inside the
 * 01:00–07:00 night window; the report may run all Monday.
 */
export const JOBS: readonly Job[] = [
  {
    name: "intake",
    workflow: "factory-intake.yml",
    due: "01:07",
    latestStart: "07:00",
    days: EVERY_DAY,
  },
  {
    name: "review",
    workflow: "factory-review.yml",
    due: "02:23",
    latestStart: "07:00",
    days: EVERY_DAY,
  },
  {
    name: "retro",
    workflow: "factory-retro.yml",
    due: "04:41",
    latestStart: "07:00",
    days: EVERY_DAY,
  },
  {
    name: "maintain",
    workflow: "factory-maintain.yml",
    due: "03:19",
    latestStart: "07:00",
    days: [6],
  },
  {
    name: "report",
    workflow: "factory-report.yml",
    due: "06:09",
    latestStart: "23:59",
    days: [0],
  },
];

interface Clock {
  readonly hour: number;
  readonly minute: number;
}

const clockOf = (time: string): Clock => {
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return { hour, minute };
};

const DAYS_IN_WEEK = 7;

/**
 * The most recent due occurrence at or before `now`, with the Budapest day it
 * falls on. Every job is due at least once a week, so the seven-day walk finds one.
 */
const occurrenceOf = (job: Job, now: Date): { at: Date; day: string } | undefined => {
  const today = budapestDay(now);
  const due = clockOf(job.due);
  for (let back = 0; back < DAYS_IN_WEEK; back++) {
    const day = shiftDay(today, -back);
    if (!job.days.includes(mondayIndex(day))) continue;
    const at = budapestAt(day, due.hour, due.minute);
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
 * and no run was created at or after it. Any run counts, whatever its event or
 * conclusion, so a failed job is not retried in a loop.
 */
export const dueJobs = (now: Date, lastRunAt: (workflow: string) => Date | undefined): Job[] =>
  JOBS.filter((job) => {
    const occurrence = occurrenceOf(job, now);
    if (occurrence === undefined) return false;
    const latestStart = clockOf(job.latestStart);
    const deadline = budapestAt(occurrence.day, latestStart.hour, latestStart.minute);
    if (now.getTime() > deadline.getTime()) return false;
    const lastRun = lastRunAt(job.workflow);
    return lastRun === undefined || lastRun.getTime() < occurrence.at.getTime();
  });
