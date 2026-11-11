import { describe, expect, it } from "vitest";
import { dueJobs } from "#schedule/due.ts";

const at = (iso: string): Date => new Date(iso);

/** The workflows due at `now`, in schedule order; a run's time is keyed by workflow file. */
const dueWorkflows = (now: string, lastRuns: Record<string, string> = {}): string[] =>
  dueJobs(at(now), (workflow) => {
    const lastRun = lastRuns[workflow];
    return lastRun === undefined ? undefined : at(lastRun);
  }).map((job) => job.workflow);

describe("dueJobs", () => {
  it("dispatches the nightly jobs whose due time has passed and that have not run since", () => {
    // 2026-11-10 is a Tuesday; 04:00 UTC is 05:00 CET, before every latest start.
    expect(dueWorkflows("2026-11-10T04:00:00Z")).toEqual([
      "factory-intake.yml",
      "factory-review.yml",
      "factory-retro.yml",
    ]);
  });

  it("leaves a job alone when a run was created at or after its due time", () => {
    expect(
      dueWorkflows("2026-11-10T04:00:00Z", {
        // Exactly at intake's 01:07 CET due time.
        "factory-intake.yml": "2026-11-10T00:07:00Z",
        "factory-review.yml": "2026-11-10T02:00:00Z",
        "factory-retro.yml": "2026-11-10T03:50:00Z",
      }),
    ).toEqual([]);
  });

  it("dispatches again when the last run predates today's due time", () => {
    expect(
      dueWorkflows("2026-11-10T04:00:00Z", {
        "factory-intake.yml": "2026-11-09T00:20:00Z",
        "factory-review.yml": "2026-11-09T02:00:00Z",
        "factory-retro.yml": "2026-11-09T04:00:00Z",
      }),
    ).toEqual(["factory-intake.yml", "factory-review.yml", "factory-retro.yml"]);
  });

  it("does not start a missed night at or after its latest start", () => {
    expect(dueWorkflows("2026-11-10T05:59:00Z")).toEqual([
      "factory-intake.yml",
      "factory-review.yml",
      "factory-retro.yml",
    ]);
    // Exactly 07:00 CET, when the night window closes: too late.
    expect(dueWorkflows("2026-11-10T06:00:00Z")).toEqual([]);
    expect(dueWorkflows("2026-11-10T06:01:00Z")).toEqual([]);
  });

  it("keeps Sunday's maintenance on Sunday and Monday's report on Monday", () => {
    expect(dueWorkflows("2026-11-08T02:30:00Z", {})).toEqual([
      "factory-intake.yml",
      "factory-review.yml",
      "factory-maintain.yml",
    ]);
    expect(dueWorkflows("2026-11-09T12:00:00Z")).toEqual(["factory-report.yml"]);
    expect(dueWorkflows("2026-11-09T22:30:00Z")).toEqual(["factory-report.yml"]);
    // 00:30 on Tuesday, past Monday 23:59 Budapest: the report waits for next week.
    expect(dueWorkflows("2026-11-09T23:30:00Z")).toEqual([]);
  });

  it("moves the due times with the spring DST switch", () => {
    // 2026-03-29 is a Sunday: 02:00 CET jumps to 03:00 CEST (01:00 UTC).
    expect(dueWorkflows("2026-03-29T01:10:00Z")).toEqual(["factory-intake.yml"]);
    // 03:30 CEST: intake (01:07), review (02:23, shifted into the gap) and the
    // Sunday maintenance (03:19) have fallen due; retro (04:41) has not.
    expect(dueWorkflows("2026-03-29T01:30:00Z")).toEqual([
      "factory-intake.yml",
      "factory-review.yml",
      "factory-maintain.yml",
    ]);
  });

  it("moves the due times with the autumn DST switch", () => {
    // 2026-10-25 is a Sunday: 03:00 CEST falls back to 02:00 CET (01:00 UTC).
    // 02:10 CEST: only intake (01:07) has fallen due.
    expect(dueWorkflows("2026-10-25T00:10:00Z")).toEqual(["factory-intake.yml"]);
    // 02:30 CEST: review's first 02:23 has passed; the day's second 02:23 is later.
    expect(dueWorkflows("2026-10-25T00:30:00Z")).toEqual([
      "factory-intake.yml",
      "factory-review.yml",
    ]);
    // 03:30 CET, after the fall back: maintenance (03:19) joins.
    expect(dueWorkflows("2026-10-25T02:30:00Z")).toEqual([
      "factory-intake.yml",
      "factory-review.yml",
      "factory-maintain.yml",
    ]);
  });
});
