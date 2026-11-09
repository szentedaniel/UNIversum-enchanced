import { describe, expect, it } from "vitest";
import { frontierOf, PRIORITY_LABELS, type IssueFacts } from "#dispatch/frontier.ts";
import type { PullFacts } from "#shared/closing-pr.ts";

/** The REST fields the dispatcher hands the frontier; only what a test reads. */
const issue = (number: number, overrides: Partial<IssueFacts> = {}): IssueFacts => ({
  number,
  title: `Ticket ${String(number)}`,
  createdAt: "2026-11-01T00:00:00Z",
  labels: ["ready-for-agent"],
  blockedBy: 0,
  openBlockers: [],
  subIssues: 0,
  ...overrides,
});

const pull = (url: string, body: string): PullFacts => ({ url, body });

describe("frontierOf", () => {
  it("takes the unblocked tickets and skips the blocked one", () => {
    const issues = [
      issue(101),
      issue(102, { createdAt: "2026-11-02T00:00:00Z" }),
      issue(103, { blockedBy: 1, openBlockers: [99] }),
    ];

    const frontier = frontierOf(issues, [], new Set());

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([101, 102]);
    expect(frontier.skipped).toEqual([{ issue: issues[2], reason: "blocked by #99" }]);
  });

  it("lets a dependant in once its blocker is closed", () => {
    const blocked = issue(103, { blockedBy: 1, openBlockers: [] });

    expect(frontierOf([blocked], [], new Set()).eligible).toEqual([blocked]);
  });

  it("lists every open blocker, in the order GitHub returns them", () => {
    const frontier = frontierOf(
      [issue(103, { blockedBy: 2, openBlockers: [99, 100] })],
      [],
      new Set(),
    );

    expect(frontier.skipped[0]?.reason).toBe("blocked by #99, #100");
  });

  it("skips the issues a run holds or a human owns", () => {
    const inProgress = issue(101, { labels: ["ready-for-agent", "agent:in-progress"] });
    const blocked = issue(102, { labels: ["ready-for-agent", "agent:blocked"] });
    const human = issue(103, { labels: ["ready-for-agent", "ready-for-human"] });

    const frontier = frontierOf([inProgress, blocked, human], [], new Set());

    expect(frontier.eligible).toEqual([]);
    expect(frontier.skipped.map((entry) => entry.reason)).toEqual([
      "a run holds it (agent:in-progress)",
      "waiting for a human (agent:blocked)",
      "the owner implements it (ready-for-human)",
    ]);
  });

  it("skips an issue that is a spec, because the implement run refuses it", () => {
    const frontier = frontierOf([issue(85, { subIssues: 8 })], [], new Set());

    expect(frontier.skipped[0]?.reason).toBe("a spec, not a ticket (8 sub-issues)");
    expect(frontierOf([issue(85, { subIssues: 1 })], [], new Set()).skipped[0]?.reason).toBe(
      "a spec, not a ticket (1 sub-issue)",
    );
  });

  it("skips an issue an open pull request already closes", () => {
    const pulls = [
      pull("https://example.test/1", "Mentions spec #101, closes nothing."),
      pull("https://example.test/2", "Closes #101"),
    ];

    const frontier = frontierOf([issue(101)], pulls, new Set());

    expect(frontier.eligible).toEqual([]);
    expect(frontier.skipped[0]?.reason).toBe("open pull request https://example.test/2");
  });

  it("skips an issue whose run is already queued, before its label lands", () => {
    const frontier = frontierOf([issue(101), issue(102)], [], new Set([101]));

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([102]);
    expect(frontier.skipped[0]?.reason).toBe("already dispatched (a run is queued or running)");
  });

  it("orders the frontier oldest first, and the skipped list the same way", () => {
    const issues = [
      issue(103, { createdAt: "2026-11-03T00:00:00Z" }),
      issue(101, { createdAt: "2026-11-01T00:00:00Z" }),
      issue(102, {
        createdAt: "2026-11-02T00:00:00Z",
        labels: ["ready-for-agent", "agent:blocked"],
      }),
      issue(100, { createdAt: "2026-11-01T00:00:00Z" }),
    ];

    const frontier = frontierOf(issues, [], new Set());

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([100, 101, 103]);
    expect(frontier.skipped.map((entry) => entry.issue.number)).toEqual([102]);
  });

  it("picks a priority:top issue before an older one: red main goes first", () => {
    const old = issue(101, { createdAt: "2026-11-01T00:00:00Z" });
    const redMain = issue(102, {
      createdAt: "2026-11-05T00:00:00Z",
      title: "Red main: CI failed on 0b9af87",
      labels: ["ready-for-agent", "bug", "priority:top"],
    });

    const frontier = frontierOf([old, redMain], [], new Set());

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([102, 101]);
    expect(PRIORITY_LABELS).toEqual(["priority:top"]);
  });
});
