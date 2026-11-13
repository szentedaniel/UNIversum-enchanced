import { describe, expect, it } from "vitest";
import {
  frontierOf,
  overlapNote,
  PRIORITY_LABELS,
  type IssueFacts,
  type OpenPull,
} from "#dispatch/frontier.ts";

/** The REST fields the dispatcher hands the frontier; only what a test reads. */
const issue = (number: number, overrides: Partial<IssueFacts> = {}): IssueFacts => ({
  number,
  title: `Ticket ${String(number)}`,
  createdAt: "2026-11-01T00:00:00Z",
  labels: ["ready-for-agent"],
  blockedBy: 0,
  openBlockers: [],
  subIssues: 0,
  body: "",
  ...overrides,
});

const pull = (number: number, overrides: Partial<OpenPull> = {}): OpenPull => ({
  number,
  url: `https://example.test/${String(number)}`,
  body: "",
  branch: `agent/issue-${String(number)}-work`,
  files: [],
  ...overrides,
});

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
      pull(1, { body: "Mentions spec #101, closes nothing." }),
      pull(2, { body: "Closes #101" }),
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

  it("skips a ticket whose named file an open pull request changes, naming the pull", () => {
    const ticket = issue(101, {
      body: "## Files\n\n- `packages/factory/src/shared/runs.ts`",
    });
    const other = issue(102, { body: "`packages/factory/src/maintain/flaky.ts`" });
    const blocking = pull(154, {
      url: "https://example.test/pull/154",
      files: ["packages/factory/src/shared/runs.ts"],
    });

    const frontier = frontierOf([ticket, other], [blocking], new Set());

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([102]);
    expect(frontier.skipped[0]?.reason).toBe(
      "overlaps open pull request #154 (https://example.test/pull/154)",
    );
    expect(frontier.skipped[0]?.blockingPull?.number).toBe(154);
  });

  it("skips a ticket whose module a pull request's branch names", () => {
    const ticket = issue(101, {
      body: "`apps/server/src/room/turn-clock.ts`",
    });
    const blocking = pull(140, {
      branch: "agent/issue-140-room-turn-clock-extract-the-clock",
    });

    const frontier = frontierOf([ticket], [blocking], new Set());

    expect(frontier.eligible).toEqual([]);
    expect(frontier.skipped[0]?.reason).toContain("#140");
  });

  it("does not block a ticket on a pull that only shares the handoff ledger", () => {
    const ticket = issue(101, {
      body: "Touch `shared/runs.ts`; append to `docs/agents/handoff/INDEX.md`.",
    });
    const blocking = pull(154, {
      branch: "agent/issue-154-record-the-handoff",
      files: ["docs/agents/handoff/INDEX.md"],
    });

    const frontier = frontierOf([ticket], [blocking], new Set());

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([101]);
    expect(frontier.skipped).toEqual([]);
  });

  it("starts only one of two tickets that name the same module", () => {
    const body = "## Files\n\n- `packages/factory/src/dispatch/frontier.ts`";
    const first = issue(101, { body });
    const duplicate = issue(102, { body });

    const frontier = frontierOf([first, duplicate], [], new Set());

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([101]);
    expect(frontier.skipped).toEqual([
      { issue: duplicate, reason: "overlaps #101 (same target module)" },
    ]);
  });

  it("lets tickets that name different modules run in parallel", () => {
    const first = issue(101, { body: "`packages/factory/src/dispatch/frontier.ts`" });
    const second = issue(102, { body: "`apps/server/src/room/turn-clock.ts`" });

    const frontier = frontierOf([first, second], [], new Set());

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([101, 102]);
    expect(frontier.skipped).toEqual([]);
  });

  it("lets a newer ticket wait for an open work item that already holds the module", () => {
    const running = issue(100, {
      labels: ["agent:in-progress"],
      body: "`packages/factory/src/dispatch/frontier.ts`",
    });
    const waiting = issue(101, { body: "`packages/factory/src/dispatch/frontier.ts`" });

    const frontier = frontierOf([waiting], [], new Set(), [running, waiting]);

    expect(frontier.eligible).toEqual([]);
    expect(frontier.skipped[0]?.reason).toBe("overlaps #100 (same target module)");
  });

  it("does not let a stalled ticket hold a newer one", () => {
    const human = issue(100, {
      labels: ["ready-for-human"],
      body: "`packages/factory/src/dispatch/frontier.ts`",
    });
    const blocked = issue(99, {
      labels: ["agent:blocked"],
      body: "`packages/factory/src/shared/runs.ts`",
    });
    const first = issue(101, { body: "`packages/factory/src/dispatch/frontier.ts`" });
    const second = issue(102, { body: "`packages/factory/src/shared/runs.ts`" });

    const frontier = frontierOf([first, second], [], new Set(), [human, blocked, first, second]);

    expect(frontier.eligible.map((entry) => entry.number)).toEqual([101, 102]);
    expect(frontier.skipped).toEqual([]);
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

describe("overlapNote", () => {
  it("names the blocking pull request number and dedupes per pull", () => {
    const blocking = {
      number: 154,
      url: "https://example.test/pull/154",
      body: "",
      branch: "agent/issue-129-shared-runs",
      files: ["packages/factory/src/shared/runs.ts"],
    };

    const note = overlapNote(blocking);

    expect(note.marker).toBe("<!-- factory-overlap:#154 -->");
    expect(note.body).toContain("open pull request #154");
    expect(note.body).toContain("https://example.test/pull/154");
    expect(note.body).toContain("once the pull request merges or closes");
  });
});
