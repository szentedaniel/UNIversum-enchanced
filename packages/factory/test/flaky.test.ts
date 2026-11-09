import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  flakyIssueBody,
  flakyIssueTitle,
  flakyTestsOf,
  newFlakyTests,
  testNameOf,
} from "#maintain/flaky.ts";

/** One real-shape `gh run view --log` excerpt: two flaky tests, one failure. */
const log = readFileSync(new URL("fixtures/playwright-flaky.txt", import.meta.url), "utf8");

const turnHold = {
  project: "desktop-chromium",
  file: "tests/turn-hold.spec.ts",
  line: 12,
  column: 1,
  title: "turn card holds the turn card",
};

const chanceCard = {
  project: "iphone-webkit",
  file: "tests/chance-card.spec.ts",
  line: 40,
  column: 3,
  title: "chance card › a card shows once",
};

describe("flakyTestsOf", () => {
  it("reads the flaky block out of a CI log, in project order", () => {
    expect(flakyTestsOf(log)).toEqual([turnHold, chanceCard]);
  });

  it("ignores a failed block and a passing run", () => {
    const failed = log
      .split("\n")
      .filter((line) => line.includes("failed"))
      .join("\n");
    expect(flakyTestsOf(failed)).toEqual([]);
    expect(flakyTestsOf("  71 passed (5.9m)\n")).toEqual([]);
  });

  it("takes plain Playwright output with no GitHub prefix and no colours", () => {
    const plain = [
      "  1 flaky",
      `    [desktop-chromium] › tests/turn-hold.spec.ts:12:1 › turn card holds the turn card ─────`,
    ];

    expect(flakyTestsOf(plain.join("\n"))).toEqual([turnHold]);
  });

  it("counts a test once when two runs' summaries share a log", () => {
    expect(flakyTestsOf(`${log}\n${log}`)).toHaveLength(2);
  });
});

describe("the flaky issue", () => {
  it("names the test by its project, file and title path, without a line number", () => {
    expect(testNameOf(turnHold)).toBe(
      "[desktop-chromium] tests/turn-hold.spec.ts › turn card holds the turn card",
    );
    expect(flakyIssueTitle(turnHold)).toBe(
      "Flaky test: [desktop-chromium] tests/turn-hold.spec.ts › turn card holds the turn card",
    );
  });

  it("marks the issue and lists the run where the retry happened", () => {
    const body = flakyIssueBody(turnHold, [
      { url: "https://github.test/o/r/actions/runs/1", createdAt: "2026-11-02T01:18:00Z" },
    ]);

    expect(body.startsWith("<!-- factory:flaky-test -->")).toBe(true);
    expect(body).toContain("`[desktop-chromium] tests/turn-hold.spec.ts:12:1`");
    expect(body).toContain("https://github.test/o/r/actions/runs/1");
  });

  it("opens no second issue for a test already tracked", () => {
    const tests = [turnHold, chanceCard];
    const open = [
      "Flaky test: [iphone-webkit] tests/chance-card.spec.ts › chance card › a card shows once",
    ];

    expect(newFlakyTests(tests, open)).toEqual([turnHold]);
    expect(newFlakyTests(tests, [...open, flakyIssueTitle(turnHold)])).toEqual([]);
  });
});
