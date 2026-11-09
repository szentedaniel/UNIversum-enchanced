import { describe, expect, it } from "vitest";
import {
  autoMergeOf,
  budgetWarning,
  fixRoundsOf,
  linesAdded,
  needsYouOf,
  reportMetrics,
  type MergedPullFacts,
  type NeedsYouItem,
  type RunFacts,
} from "#report/metrics.ts";

const pull = (number: number, overrides: Partial<MergedPullFacts> = {}): MergedPullFacts => ({
  number,
  title: `Pull ${String(number)}`,
  url: `https://github.com/o/r/pull/${String(number)}`,
  mergedAt: "2026-11-05T10:00:00Z",
  closes: [],
  fixRounds: 0,
  auto: false,
  ...overrides,
});

const needsYou = (number: number, overrides: Partial<NeedsYouItem> = {}): NeedsYouItem => ({
  number,
  title: `Item ${String(number)}`,
  url: `https://github.com/o/r/issues/${String(number)}`,
  createdAt: "2026-11-01T00:00:00Z",
  labels: ["ready-for-human"],
  ...overrides,
});

const run = (
  startedAt: string | null,
  createdAt = startedAt ?? "2026-11-01T00:00:00Z",
): RunFacts => ({
  startedAt,
  createdAt,
});

describe("fixRoundsOf", () => {
  it("takes the highest round a fix loop left on the pull request", () => {
    expect(fixRoundsOf(["<!-- factory-fix:round 1 -->", "<!-- factory-fix:round 2 -->"])).toBe(2);
    expect(fixRoundsOf(["<!-- factory-fix:round 2 -->\n<!-- factory-fix:round 1 -->"])).toBe(2);
  });

  it("is zero when no fix loop touched the pull request", () => {
    expect(fixRoundsOf([])).toBe(0);
    expect(fixRoundsOf(["reviewed", "<!-- factory-fix:round -->"])).toBe(0);
  });
});

describe("linesAdded", () => {
  it("sums the added lines of a numstat log", () => {
    expect(linesAdded("12\t0\tdocs/agents/factory-log.md\n")).toBe(12);
    expect(linesAdded("3\t1\tdocs/agents/factory-log.md\n4\t0\tdocs/agents/factory-log.md\n")).toBe(
      7,
    );
  });

  it("counts a binary file and an empty log as no lines", () => {
    expect(linesAdded("-\t-\tsome/image.png\n")).toBe(0);
    expect(linesAdded("")).toBe(0);
  });
});

describe("budgetWarning", () => {
  it("stays quiet below 80 percent of the month's minutes", () => {
    expect(budgetWarning(0, 1400)).toBeNull();
    expect(budgetWarning(1119, 1400)).toBeNull();
    expect(budgetWarning(500, 1400)).toBeNull();
  });

  it("warns at 80 percent and names the share and the numbers", () => {
    const warning = budgetWarning(1120, 1400);

    expect(warning).toContain("80%");
    expect(warning).toContain("1120 of 1400 minutes");
  });

  it("says the dispatcher is idle once the month is spent", () => {
    expect(budgetWarning(1400, 1400)).toContain("spent");
    expect(budgetWarning(1402, 1400)).toContain("1402 of 1400 minutes");
  });
});

describe("autoMergeOf", () => {
  const merged = "Merged in 4a5ae77c5d2b4a5ae77c5d2b4a5ae77c5d2b4a5a.";

  it("reads the gate's merge comment on the closing issue as an auto-merge", () => {
    expect(autoMergeOf([], [merged])).toBe(true);
  });

  it("reads a merge with no gate comment as a person's", () => {
    expect(autoMergeOf([], [])).toBe(false);
    expect(autoMergeOf(["Reviewed."], ["Deployed to staging."])).toBe(false);
  });

  it("reads a merged escalation as a person's, whatever else the issue says", () => {
    expect(autoMergeOf(["<!-- factory-merge -->\nWaiting for a human."], [merged])).toBe(false);
  });
});

describe("needsYouOf", () => {
  it("keeps the owner's labels, oldest first", () => {
    const items = [
      needsYou(3, { createdAt: "2026-11-03T00:00:00Z", labels: ["ready-for-human", "risk:high"] }),
      needsYou(1, { createdAt: "2026-10-20T00:00:00Z", labels: ["spec:proposed"] }),
      needsYou(2, { createdAt: "2026-11-01T00:00:00Z", labels: ["ready-for-human"] }),
    ];

    expect(needsYouOf(items).map((item) => [item.number, item.labels])).toEqual([
      [1, ["spec:proposed"]],
      [2, ["ready-for-human"]],
      [3, ["ready-for-human"]],
    ]);
  });

  it("lists a pull request too, and one item per number", () => {
    const items = [
      needsYou(9, { url: "https://github.com/o/r/pull/9", labels: ["ready-for-human"] }),
      needsYou(9, { labels: ["ready-for-human", "spec:proposed"] }),
    ];

    expect(needsYouOf(items)).toEqual([items[0]]);
  });

  it("drops an item with none of the owner's labels", () => {
    expect(needsYouOf([needsYou(4, { labels: ["factory"] })])).toEqual([]);
  });
});

describe("reportMetrics", () => {
  it("counts the week's tickets, rounds, merge split and idea-to-merge median", () => {
    const metrics = reportMetrics({
      mergedPulls: [
        pull(100, {
          mergedAt: "2026-11-05T10:00:00Z",
          closes: [{ number: 50, createdAt: "2026-11-03T10:00:00Z" }],
          fixRounds: 2,
          auto: true,
        }),
        pull(101, {
          mergedAt: "2026-11-06T10:00:00Z",
          closes: [{ number: 51, createdAt: "2026-11-01T10:00:00Z" }],
          fixRounds: 0,
        }),
        pull(102, {
          mergedAt: "2026-11-07T10:00:00Z",
          closes: [{ number: 52, createdAt: "2026-11-07T04:00:00Z" }],
          fixRounds: 1,
        }),
      ],
      blockedOpen: [7, 8],
      blockedThisWeek: [8, 9],
      claudeRuns: [
        run("2026-11-03T02:00:00Z"),
        run("2026-11-04T02:00:00Z"),
        run("2026-11-05T02:00:00Z"),
        run("2026-11-04T12:00:00Z"),
      ],
      ompRuns: [run("2026-11-03T09:00:00Z"), run("2026-11-04T09:00:00Z")],
      minutes: { month: 500, week: 120, limit: 1400 },
      retroLines: null,
    });

    expect(metrics.ticketsMerged).toBe(3);
    expect(metrics.blocked).toBe(3);
    expect(metrics.meanFixRounds).toBe(1);
    expect(metrics.autoMerged).toBe(1);
    expect(metrics.humanMerged).toBe(2);
    expect(metrics.medianIdeaToMergeHours).toBe(48);
    expect(metrics.claudeNight).toBe(3);
    expect(metrics.claudeDay).toBe(1);
    expect(metrics.ompRuns).toBe(2);
    expect(metrics.minutes).toEqual({ month: 500, week: 120, limit: 1400 });
    expect(metrics.retroLines).toBeNull();
  });

  it("counts a pull request's two closing issues as two tickets and splits an even median", () => {
    const metrics = reportMetrics({
      mergedPulls: [
        pull(100, {
          mergedAt: "2026-11-05T10:00:00Z",
          closes: [
            { number: 50, createdAt: "2026-11-03T10:00:00Z" },
            { number: 51, createdAt: "2026-11-05T04:00:00Z" },
          ],
        }),
        pull(101, {
          mergedAt: "2026-11-06T10:00:00Z",
          closes: [
            { number: 52, createdAt: "2026-11-06T04:00:00Z" },
            { number: 53, createdAt: "2026-11-04T10:00:00Z" },
          ],
        }),
      ],
      blockedOpen: [],
      blockedThisWeek: [],
      claudeRuns: [],
      ompRuns: [],
      minutes: { month: 0, week: 0, limit: 1400 },
      retroLines: 24,
    });

    expect(metrics.ticketsMerged).toBe(4);
    expect(metrics.medianIdeaToMergeHours).toBe(27);
    expect(metrics.retroLines).toBe(24);
  });

  it("reads a week with nothing in it as zeros and none yet, never a crash", () => {
    const metrics = reportMetrics({
      mergedPulls: [],
      blockedOpen: [],
      blockedThisWeek: [],
      claudeRuns: [],
      ompRuns: [],
      minutes: { month: 0, week: 0, limit: 1400 },
      retroLines: null,
    });

    expect(metrics).toEqual({
      ticketsMerged: 0,
      blocked: 0,
      meanFixRounds: null,
      autoMerged: 0,
      humanMerged: 0,
      medianIdeaToMergeHours: null,
      minutes: { month: 0, week: 0, limit: 1400 },
      claudeNight: 0,
      claudeDay: 0,
      ompRuns: 0,
      retroLines: null,
    });
  });
});
