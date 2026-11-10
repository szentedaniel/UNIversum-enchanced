/**
 * The report's calendar: the Budapest week that just ended, and the Monday
 * 06:00 slot the two UTC crons are aimed at. Pure — the report script passes
 * the run's clock in.
 */
import { budapestDay, budapestHour, TIME_ZONE } from "#review/window.ts";

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

const BUDAPEST_PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** How far Budapest runs ahead of UTC at `at`, in milliseconds. */
const budapestOffset = (at: Date): number => {
  const parts = new Map(
    BUDAPEST_PARTS.formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const wall = Date.UTC(
    Number(parts.get("year")),
    Number(parts.get("month")) - 1,
    Number(parts.get("day")),
    Number(parts.get("hour")),
    Number(parts.get("minute")),
    Number(parts.get("second")),
  );
  return wall - at.getTime();
};

/** A civil date shifted by whole days; UTC arithmetic, so DST never matters. */
const shiftDay = (day: string, days: number): string => {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
};

/** Where `day` falls in the week, Monday 0 … Sunday 6. */
const mondayIndex = (day: string): number => {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
};

/** The instant of Budapest midnight starting `day`; the second pass survives a DST switch. */
const budapestMidnight = (day: string): Date => {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, date);
  const first = utc - budapestOffset(new Date(utc));
  return new Date(utc - budapestOffset(new Date(first)));
};

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
    start: budapestMidnight(weekOf),
    end: budapestMidnight(endOf),
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
