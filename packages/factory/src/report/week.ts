/**
 * The report's calendar: the Budapest week that just ended. Pure — the report
 * script passes the run's clock in.
 */
import { budapestAt, budapestDay, mondayIndex, shiftDay } from "#shared/budapest.ts";

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

/** Whether `at` falls in `[start, end)`; an unreadable or missing time does not. */
export const inWindow = (at: string | null | undefined, week: WeekWindow): boolean => {
  if (at === null || at === undefined) return false;
  const time = Date.parse(at);
  return Number.isFinite(time) && time >= week.start.getTime() && time < week.end.getTime();
};
