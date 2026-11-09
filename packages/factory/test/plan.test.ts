import { describe, expect, it } from "vitest";
import type { IssueFacts } from "#dispatch/frontier.ts";
import { noDispatchReason, planOf } from "#dispatch/plan.ts";

const issue = (number: number): IssueFacts => ({
  number,
  title: `Ticket ${String(number)}`,
  createdAt: "2026-11-01T00:00:00Z",
  labels: ["ready-for-agent"],
  blockedBy: 0,
  openBlockers: [],
  subIssues: 0,
});

describe("planOf", () => {
  it("fills the free slots with the oldest issues and leaves the rest waiting", () => {
    const plan = planOf([issue(101), issue(102), issue(103)], 0, 2);

    expect(plan.dispatch.map((entry) => entry.number)).toEqual([101, 102]);
    expect(plan.waiting.map((entry) => entry.number)).toEqual([103]);
  });

  it("dispatches nothing while the cap is reached", () => {
    const plan = planOf([issue(101)], 2, 2);

    expect(plan.dispatch).toEqual([]);
    expect(plan.waiting.map((entry) => entry.number)).toEqual([101]);
  });

  it("never reads a negative headroom, however many runs are running", () => {
    expect(planOf([issue(101)], 3, 2).dispatch).toEqual([]);
    expect(planOf([issue(101)], 1, 2).dispatch.map((entry) => entry.number)).toEqual([101]);
  });
});

describe("noDispatchReason", () => {
  it("says the frontier is empty when no issue is eligible, even with free slots", () => {
    expect(noDispatchReason([], 0, 2)).toBe("Dispatch: none — the frontier is empty.");
    expect(noDispatchReason([], 1, 2)).toBe("Dispatch: none — the frontier is empty.");
  });

  it("names how many implementers hold the slots when the frontier waits", () => {
    expect(noDispatchReason([issue(101)], 2, 2)).toBe(
      "Dispatch: none — no free slot (2 of 2 running).",
    );
    expect(noDispatchReason([issue(101)], 3, 2)).toBe(
      "Dispatch: none — no free slot (3 of 2 running).",
    );
  });
});
