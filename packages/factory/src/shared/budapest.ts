/**
 * Europe/Budapest wall-clock arithmetic, built on Intl so DST needs no table:
 * the factory's review window, nightly schedule and weekly report are all
 * Budapest local times.
 */

export const TIME_ZONE = "Europe/Budapest";

const DAY_MS = 24 * 60 * 60 * 1000;

/** The week's days, Monday 0 … Sunday 6. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

/** A weekday, Monday 0 … Sunday 6. */
export type Weekday = (typeof WEEKDAYS)[number];

const PARTS = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

/** The Budapest civil date and clock time at `at`; `wall` is the same reading as a UTC timestamp. */
const budapestParts = (at: Date): { day: string; hour: number; minute: number; wall: number } => {
  const parts = new Map(
    PARTS.formatToParts(at)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const year = Number(parts.get("year"));
  const month = Number(parts.get("month"));
  const date = Number(parts.get("day"));
  const hour = Number(parts.get("hour"));
  const minute = Number(parts.get("minute"));
  return {
    day: `${String(year)}-${String(month).padStart(2, "0")}-${String(date).padStart(2, "0")}`,
    hour,
    minute,
    wall: Date.UTC(year, month - 1, date, hour, minute, Number(parts.get("second"))),
  };
};

const civilDate = (day: string): { year: number; month: number; date: number } => {
  const [year = 1970, month = 1, date = 1] = day.split("-").map(Number);
  return { year, month, date };
};

/** How far Budapest runs ahead of UTC at `at`, in milliseconds. */
const budapestOffset = (at: Date): number => budapestParts(at).wall - at.getTime();

/** The Budapest calendar day, `YYYY-MM-DD`. */
export const budapestDay = (at: Date): string => budapestParts(at).day;

/** The Budapest clock hour, 0–23. */
export const budapestHour = (at: Date): number => budapestParts(at).hour;

/** A civil date shifted by whole days; UTC arithmetic, so DST never matters. */
export const shiftDay = (day: string, days: number): string => {
  const { year, month, date } = civilDate(day);
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10);
};

/** Where `day` falls in the week, Monday 0 … Sunday 6. */
export const mondayIndex = (day: string): Weekday => {
  const { year, month, date } = civilDate(day);
  const index = (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
  return WEEKDAYS[index] ?? 0;
};

/**
 * The instant of a Budapest wall time. When the autumn switch repeats the
 * clock, the earlier occurrence; in the spring gap, the wall time shifts
 * forward by the jump.
 */
export const budapestAt = (day: string, hour: number, minute = 0): Date => {
  const { year, month, date } = civilDate(day);
  const wall = Date.UTC(year, month - 1, date, hour, minute);
  const near = new Set(
    [wall - DAY_MS, wall + DAY_MS].map((instant) => wall - budapestOffset(new Date(instant))),
  );
  const matches = [...near].filter((candidate) => budapestParts(new Date(candidate)).wall === wall);
  if (matches.length > 0) return new Date(Math.min(...matches));
  const first = wall - budapestOffset(new Date(wall));
  return new Date(wall - budapestOffset(new Date(first)));
};
