import { describe, expect, it } from "vitest";
import type { NeedsYouItem, ReportMetrics } from "#report/metrics.ts";
import { reportBody } from "#report/render.ts";
import { weekWindow } from "#report/week.ts";

const week = weekWindow(new Date("2026-11-09T05:00:00Z"));

const metrics = (overrides: Partial<ReportMetrics> = {}): ReportMetrics => ({
  ticketsMerged: 3,
  blocked: 1,
  meanFixRounds: 1.5,
  autoMerged: 2,
  humanMerged: 1,
  medianIdeaToMergeHours: 50.4,
  minutes: { month: 500, week: 120, limit: 1400 },
  claudeNight: 3,
  claudeDay: 1,
  ompRuns: 6,
  retroLines: 24,
  ...overrides,
});

const waiting = (
  number: number,
  title: string,
  labels: string[],
  createdAt: string,
): NeedsYouItem => ({
  number,
  title,
  url: `https://github.com/o/r/issues/${String(number)}`,
  createdAt,
  labels,
});

const body = (overrides: Partial<ReportMetrics> = {}, needsYou: NeedsYouItem[] = []) =>
  reportBody({ week, metrics: metrics(overrides), needsYou });

describe("reportBody", () => {
  it("opens with the week's hidden marker and names the Budapest week", () => {
    const lines = body().split("\n");

    expect(lines[0]).toBe("<!-- factory-report:2026-11-02 -->");
    expect(lines).toContain("# Factory report: week of 2026-11-02");
    expect(lines).toContain("Monday 2026-11-02 00:00 to Monday 2026-11-09 00:00, Europe/Budapest.");
  });

  it("puts the week's numbers in the table", () => {
    expect(body()).toContain("| Tickets merged | 3 |");
    expect(body()).toContain("| Blocked | 1 |");
    expect(body()).toContain("| Fix rounds (mean) | 1.5 |");
    expect(body()).toContain("| Merges | 2 auto / 1 human |");
    expect(body()).toContain("| Idea → merge (median) | 2.1 days |");
    expect(body()).toContain("| Minutes | 500 of 1400 this month; 120 this week |");
    expect(body()).toContain("| Claude runs | 3 night, 1 day |");
    expect(body()).toContain("| omp runs | 6 |");
    expect(body()).toContain("| Retro changes | 24 lines |");
  });

  it("says none yet for an average and a log that do not exist, and counts a zero week", () => {
    const empty = body({
      ticketsMerged: 0,
      blocked: 0,
      meanFixRounds: null,
      autoMerged: 0,
      humanMerged: 0,
      medianIdeaToMergeHours: null,
      claudeNight: 0,
      claudeDay: 0,
      ompRuns: 0,
      retroLines: null,
    });

    expect(empty).toContain("| Tickets merged | 0 |");
    expect(empty).toContain("| Blocked | 0 |");
    expect(empty).toContain("| Fix rounds (mean) | none yet |");
    expect(empty).toContain("| Merges | none yet |");
    expect(empty).toContain("| Idea → merge (median) | none yet |");
    expect(empty).toContain("| Claude runs | none yet |");
    expect(empty).toContain("| omp runs | none yet |");
    expect(empty).toContain("| Retro changes | none yet |");
  });

  it("reads a short idea-to-merge time in hours", () => {
    expect(body({ medianIdeaToMergeHours: 6 })).toContain("| Idea → merge (median) | 6 hours |");
    expect(body({ medianIdeaToMergeHours: 48 })).toContain("| Idea → merge (median) | 2 days |");
  });

  it("carries the budget warning at 80 percent and stays quiet below it", () => {
    expect(body()).not.toContain("**Budget:**");
    expect(body({ minutes: { month: 1120, week: 0, limit: 1400 } })).toContain(
      "**Budget:** The monthly budget is 80% spent (1120 of 1400 minutes).",
    );
  });

  it("lists the owner's queue as links, oldest first, with the label and the date", () => {
    const text = body({}, [
      waiting(31, "Fix the merge gate", ["ready-for-human"], "2026-10-20T08:00:00Z"),
      waiting(42, "A spec draft", ["spec:proposed"], "2026-11-01T08:00:00Z"),
    ]);

    expect(text).toContain(
      [
        "## Needs you",
        "",
        "- [#31 Fix the merge gate](https://github.com/o/r/issues/31) — ready-for-human, since 2026-10-20",
        "- [#42 A spec draft](https://github.com/o/r/issues/42) — spec:proposed, since 2026-11-01",
      ].join("\n"),
    );
  });

  it("says nothing is waiting when the queue is empty", () => {
    expect(body()).toContain("## Needs you\n\nNothing is waiting for you.\n");
  });
});
