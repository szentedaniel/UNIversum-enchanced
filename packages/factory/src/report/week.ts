/**
 * The report's calendar: the Budapest week that just ended, and the Monday
 * 06:00 slot the report is due at. Pure — the report script passes the run's
 * clock in.
 */
import { budapestAt, budapestDay, budapestHour, mondayIndex, shiftDay } from "#shared/budapest.ts";

/** The hour the weekly report runs, Budapest time. */
export const REPORT_HOUR = 6;

export interface WeekWindow {
  /** `YYYY-MM-DD` of the Monday that started the reported week. */
  readonly weekOf: string;
  /** `YYYY-MM-DD` of the next Monday, the exclusive end of the week. */
  readonly endOf: string;
  /** The week's first instant: Monday 00:00 Europe/Budapest. */
  readonly start: Date;
  /** The week's end: the next Monday 00:00 Europe/Budapest. */
  readonly end: Date;
}

/**
 * The week that just ended: a run on any day of the current Budapest week
 * reports the seven days before this week's Monday, so a re-run later in the
 * week still edits the same issue.
 */
export const weekWindow = (now: Date): WeekWindow => {
  const today = budapestDay(now);
  const endOf = shiftDay(today, -mondayIndex(today));
  const weekOf = shiftDay(endOf, -7);
  return {
    weekOf,
    endOf,
    start: budapestAt(weekOf, 0),
    end: budapestAt(endOf, 0),
  };
};

/**
 * Whether a scheduled run may post: from 06:00 Budapest on. GitHub's cron is
 * UTC, so the workflow schedules a slot an hour apart on Monday; the early one
 * is 05:xx in winter and skips. GitHub often starts a scheduled run hours
 * late, so a late slot posts too; a second run that day edits the same issue.
 */
export const scheduleSlot = (at: Date): boolean => budapestHour(at) >= REPORT_HOUR;

/** Whether `at` falls in `[start, end)`; an unreadable or missing time does not. */
export const inWindow = (at: string | null | undefined, week: WeekWindow): boolean => {
  if (at === null || at === undefined) return false;
  const time = Date.parse(at);
  return Number.isFinite(time) && time >= week.start.getTime() && time < week.end.getTime();
};
