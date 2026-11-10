import { describe, expect, it } from "vitest";
import { inWindow, scheduleSlot, weekWindow } from "#report/week.ts";

const at = (iso: string): Date => new Date(iso);

describe("weekWindow", () => {
  it("reports the Budapest week that just ended, Monday to Monday", () => {
    // 2026-11-09 is a Monday; 05:00 UTC is 06:00 CET.
    const week = weekWindow(at("2026-11-09T05:00:00Z"));

    expect(week.weekOf).toBe("2026-11-02");
    expect(week.endOf).toBe("2026-11-09");
    expect(week.start.toISOString()).toBe("2026-11-01T23:00:00.000Z");
    expect(week.end.toISOString()).toBe("2026-11-08T23:00:00.000Z");
  });

  it("keeps the same week when it runs later in the week", () => {
    const monday = weekWindow(at("2026-11-09T05:00:00Z"));
    const wednesday = weekWindow(at("2026-11-11T12:00:00Z"));

    expect(wednesday).toEqual(monday);
  });

  it("is DST-safe: the week starts and ends at Budapest midnight", () => {
    // 2026-06-01 is a Monday in CEST (UTC+2): 04:00 UTC is 06:00.
    const summer = weekWindow(at("2026-06-01T04:00:00Z"));
    expect(summer.weekOf).toBe("2026-05-25");
    expect(summer.start.toISOString()).toBe("2026-05-24T22:00:00.000Z");
    expect(summer.end.toISOString()).toBe("2026-05-31T22:00:00.000Z");

    // The week that contains 2026-10-25's fall-back is 169 hours long.
    const fallBack = weekWindow(at("2026-10-26T06:00:00Z"));
    expect(fallBack.weekOf).toBe("2026-10-19");
    expect(fallBack.start.toISOString()).toBe("2026-10-18T22:00:00.000Z");
    expect(fallBack.end.toISOString()).toBe("2026-10-25T23:00:00.000Z");
  });

  it("reads the week in Budapest, not in UTC", () => {
    // Sunday 23:30 UTC is already Monday 00:30 in Budapest; the week just ended.
    const week = weekWindow(at("2026-11-08T23:30:00Z"));

    expect(week.weekOf).toBe("2026-11-02");
    expect(week.end.toISOString()).toBe("2026-11-08T23:00:00.000Z");
  });
});

describe("scheduleSlot", () => {
  it("runs from 06:00 Budapest in either season, whichever cron slot hits it", () => {
    // Winter: the 05:09 UTC cron is 06:09 CET; the 04:09 UTC one is 05:09.
    expect(scheduleSlot(at("2026-11-09T05:09:00Z"))).toBe(true);
    expect(scheduleSlot(at("2026-11-09T04:09:00Z"))).toBe(false);

    // Summer: the 04:09 UTC cron is 06:09 CEST.
    expect(scheduleSlot(at("2026-06-01T04:09:00Z"))).toBe(true);
  });

  it("still posts when GitHub starts the scheduled run hours late", () => {
    expect(scheduleSlot(at("2026-11-09T12:37:00Z"))).toBe(true);
  });
});

describe("inWindow", () => {
  const week = weekWindow(at("2026-11-09T05:00:00Z"));

  it("includes the start and excludes the next Monday", () => {
    expect(inWindow("2026-11-01T23:00:00Z", week)).toBe(true);
    expect(inWindow("2026-11-08T22:59:59Z", week)).toBe(true);
    expect(inWindow("2026-11-08T23:00:00Z", week)).toBe(false);
    expect(inWindow("2026-11-01T22:59:59Z", week)).toBe(false);
  });

  it("treats a missing or unreadable time as outside the week", () => {
    expect(inWindow(null, week)).toBe(false);
    expect(inWindow("not a date", week)).toBe(false);
  });
});
