import { describe, expect, it } from "vitest";
import {
  budgetNotice,
  isFactoryWorkflow,
  jobMinutes,
  minutesUsed,
  monthStart,
} from "#dispatch/budget.ts";

const now = new Date("2026-11-08T12:00:00Z");

const job = (startedAt: string | null, completedAt: string | null) => ({ startedAt, completedAt });

describe("jobMinutes", () => {
  it("rounds a job up to whole minutes, the way GitHub bills it", () => {
    expect(jobMinutes(job("2026-11-08T10:00:00Z", "2026-11-08T10:00:01Z"), now)).toBe(1);
    expect(jobMinutes(job("2026-11-08T10:00:00Z", "2026-11-08T10:00:59Z"), now)).toBe(1);
    expect(jobMinutes(job("2026-11-08T10:00:00Z", "2026-11-08T10:01:00Z"), now)).toBe(1);
    expect(jobMinutes(job("2026-11-08T10:00:00Z", "2026-11-08T10:01:01Z"), now)).toBe(2);
    expect(jobMinutes(job("2026-11-08T10:00:00Z", "2026-11-08T10:05:30Z"), now)).toBe(6);
  });

  it("counts a running job up to now and a job that never started as nothing", () => {
    expect(jobMinutes(job("2026-11-08T11:58:30Z", null), now)).toBe(2);
    expect(jobMinutes(job(null, null), now)).toBe(0);
  });
});

describe("minutesUsed", () => {
  it("sums the month's jobs, each rounded on its own", () => {
    const jobs = [
      job("2026-11-01T10:00:00Z", "2026-11-01T10:00:30Z"),
      job("2026-11-01T11:00:00Z", "2026-11-01T11:00:30Z"),
      job(null, null),
    ];

    expect(minutesUsed(jobs, now)).toBe(2);
  });
});

describe("monthStart", () => {
  it("starts the calendar month at midnight UTC", () => {
    expect(monthStart(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-11-01T00:00:00Z"))).toBe("2026-11-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-01-31T23:59:59Z"))).toBe("2026-01-01T00:00:00.000Z");
  });

  it("reads the month in UTC, not in the runner's timezone", () => {
    expect(monthStart(new Date("2026-11-01T00:30:00+01:00"))).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("budgetNotice", () => {
  it("names the spent minutes, the month and the reset date", () => {
    const notice = budgetNotice(1402, 1400, "2026-11-01T00:00:00.000Z");

    expect(notice.marker).toBe("<!-- factory:budget:2026-11 -->");
    expect(notice.title).toBe("Factory report — 2026-11");
    expect(notice.body).toContain("**1402 of 1400 minutes** used in 2026-11");
    expect(notice.body).toContain("until 2026-12-01");
    expect(notice.body.endsWith(notice.marker)).toBe(true);
  });

  it("rolls the reset date over the year", () => {
    expect(budgetNotice(1400, 1400, "2026-12-01T00:00:00.000Z").body).toContain("until 2027-01-01");
  });
});

describe("isFactoryWorkflow", () => {
  it("matches the factory's own workflows and nothing else", () => {
    expect(isFactoryWorkflow(".github/workflows/factory-implement.yml")).toBe(true);
    expect(isFactoryWorkflow(".github/workflows/factory-dispatch.yml")).toBe(true);
    expect(isFactoryWorkflow(".github/workflows/factory-review.yaml")).toBe(true);
    expect(isFactoryWorkflow(".github/workflows/ci.yml")).toBe(false);
    expect(isFactoryWorkflow(".github/workflows/factory.md")).toBe(false);
    expect(isFactoryWorkflow("apps/factory-implement.yml")).toBe(false);
  });
});
