import { describe, expect, it } from "vitest";
import type { FixReason } from "#fix/reasons.ts";
import { readMergeFacts, type MergeReader, type PullView } from "#merge/facts.ts";
import { performStep, type MergeActions } from "#merge/perform.ts";
import { escalationComment } from "#merge/comment.ts";
import { mergeStep, type MergeStep } from "#merge/gates.ts";
import { summaryComment } from "#review/summary.ts";

const HEAD_SHA = "head-sha";

const pull = (overrides: Partial<PullView> = {}): PullView => ({
  number: 132,
  state: "OPEN",
  title: "Implement #132: deepen the merge gate's script",
  body: "Closes #132",
  headRefName: "agent/issue-132-deepen-the-merge-gate",
  headRefOid: HEAD_SHA,
  mergeStateStatus: "CLEAN",
  labels: ["risk:low"],
  closing: [132],
  headCommittedAt: "2026-11-09T09:00:00Z",
  author: "universum-factory[bot]",
  ...overrides,
});

const reader = (overrides: Partial<MergeReader> = {}): MergeReader => ({
  pullOf: () => pull(),
  changedFiles: () => [],
  ciRuns: () => [],
  compareOf: () => ({ mergeBase: "merge-base", mainAheadBy: 0, files: [] }),
  contentAt: () => undefined,
  issueComments: () => [],
  ...overrides,
});

describe("readMergeFacts", () => {
  it("assembles the facts the gate decides on", () => {
    const ciRuns = [
      {
        headSha: HEAD_SHA,
        status: "completed",
        conclusion: "success",
        createdAt: "2026-11-09T09:10:00Z",
      },
    ];
    const comments = [{ body: "<!-- factory-review -->\npass", createdAt: "2026-11-09T09:20:00Z" }];

    const read = readMergeFacts(
      "owner/repo",
      "132",
      reader({
        pullOf: () => pull({ mergeStateStatus: "DIRTY" }),
        changedFiles: () => ["apps/web/src/Game.tsx"],
        ciRuns: () => ciRuns,
        compareOf: () => ({
          mergeBase: "merge-base",
          mainAheadBy: 3,
          files: ["apps/web/src/Game.tsx"],
        }),
        issueComments: () => comments,
      }),
    );

    expect(read.pull.number).toBe(132);
    expect(read.facts).toEqual({
      headSha: HEAD_SHA,
      headCommittedAt: "2026-11-09T09:00:00Z",
      labels: ["risk:low"],
      ciRuns,
      comments,
      files: ["apps/web/src/Game.tsx"],
      dependencyChanges: [],
      mergeState: "dirty",
      mainAheadBy: 3,
      mainFiles: ["apps/web/src/Game.tsx"],
    });
  });

  it("reads the dependency maps at the merge base and the head", () => {
    const contents: Record<string, string> = {
      "package.json@merge-base": '{"dependencies":{"react":"^18.2.0"}}',
      "package.json@head-sha": '{"dependencies":{"react":"^19.0.0"}}',
    };

    const read = readMergeFacts(
      "owner/repo",
      "132",
      reader({
        changedFiles: () => ["package.json", "apps/web/src/Game.tsx"],
        contentAt: (_repo, file, ref) => contents[`${file}@${ref}`],
      }),
    );

    expect(read.facts.dependencyChanges).toEqual([
      { file: "package.json", before: { react: "^18.2.0" }, after: { react: "^19.0.0" } },
    ]);
  });

  it("skips a package.json the pull request adds or removes", () => {
    const read = readMergeFacts(
      "owner/repo",
      "132",
      reader({
        changedFiles: () => ["package.json"],
        contentAt: (_repo, _file, ref) => (ref === HEAD_SHA ? '{"dependencies":{}}' : undefined),
      }),
    );

    expect(read.facts.dependencyChanges).toEqual([]);
  });
});

type Write =
  | { readonly kind: "label"; readonly name: string }
  | { readonly kind: "comment"; readonly body: string }
  | { readonly kind: "dispatchFix"; readonly reason: FixReason }
  | { readonly kind: "merge"; readonly subject: string }
  | { readonly kind: "commentOnIssue"; readonly issue: number; readonly body: string }
  | { readonly kind: "closeIssue"; readonly issue: number };

const actions = (options: { mergeCommit?: string; ticketTitle?: string } = {}) => {
  const writes: Write[] = [];
  const ticketReads: number[] = [];
  const adapter: MergeActions = {
    label: (name) => void writes.push({ kind: "label", name }),
    comment: (body) => void writes.push({ kind: "comment", body }),
    dispatchFix: (reason) => void writes.push({ kind: "dispatchFix", reason }),
    merge: (subject) => {
      writes.push({ kind: "merge", subject });
      return options.mergeCommit ?? "abc1234";
    },
    commentOnIssue: (issue, body) => void writes.push({ kind: "commentOnIssue", issue, body }),
    closeIssue: (issue) => void writes.push({ kind: "closeIssue", issue }),
    ticketTitle: (issue) => {
      ticketReads.push(issue);
      return options.ticketTitle ?? "Deepen the merge gate's script";
    },
  };
  return { adapter, writes, ticketReads };
};

const context = (adapter: MergeActions, dryRun = false) => ({ actions: adapter, dryRun });

describe("performStep", () => {
  it("hands an escalated pull request to the owner: one comment and the label", () => {
    const { adapter, writes } = actions();
    const reasons = ["CI failed on abc1234", "touches .github/"];

    performStep({ kind: "escalate", reasons }, pull(), context(adapter));

    expect(writes).toEqual([
      { kind: "comment", body: escalationComment(reasons) },
      { kind: "label", name: "ready-for-human" },
    ]);
  });

  it("dispatches the fix workflow with the step's reason", () => {
    const { adapter, writes } = actions();

    performStep({ kind: "fix", reason: "main-moved" }, pull(), context(adapter));

    expect(writes).toEqual([{ kind: "dispatchFix", reason: "main-moved" }]);
  });

  it("queues the re-review a moved head needs", () => {
    const { adapter, writes } = actions();

    performStep({ kind: "requeue-review" }, pull(), context(adapter));

    expect(writes).toEqual([{ kind: "label", name: "agent:review" }]);
  });

  it("waits without writing anything", () => {
    const { adapter, writes } = actions();

    performStep(
      { kind: "wait", reason: "CI is still running on abc1234" },
      pull(),
      context(adapter),
    );

    expect(writes).toEqual([]);
  });

  it("names the merge by the ticket's title, not the pull request's", () => {
    const { adapter, writes, ticketReads } = actions({
      ticketTitle: "Deepen the merge gate's script",
    });

    performStep({ kind: "merge" }, pull(), context(adapter));

    expect(ticketReads).toEqual([132]);
    expect(writes).toEqual([
      { kind: "merge", subject: "chore(merge): #132 Deepen the merge gate's script" },
      {
        kind: "commentOnIssue",
        issue: 132,
        body: "Merged in abc1234.",
      },
      { kind: "closeIssue", issue: 132 },
    ]);
  });

  it("reads the ticket the pull request's body closes when the API names none", () => {
    const { adapter, writes } = actions();

    performStep(
      { kind: "merge" },
      pull({ closing: [], body: "This pull request closes #132." }),
      context(adapter),
    );

    expect(writes[0]).toEqual({
      kind: "merge",
      subject: "chore(merge): #132 Deepen the merge gate's script",
    });
  });

  it("names a dependency bump by its pull request, which closes no ticket", () => {
    const { adapter, writes, ticketReads } = actions();

    performStep(
      { kind: "merge" },
      pull({
        title: "Bump react from 18 to 19",
        body: null,
        closing: [],
        headRefName: "dependabot/npm/react-19",
        author: "dependabot[bot]",
      }),
      context(adapter),
    );

    expect(ticketReads).toEqual([]);
    expect(writes).toEqual([
      { kind: "merge", subject: "chore(merge): #132 Bump react from 18 to 19" },
    ]);
  });

  it("fails when the merge reports no merge commit", () => {
    for (const mergeCommit of ["", "null"]) {
      const { adapter, writes } = actions({ mergeCommit });

      expect(() => performStep({ kind: "merge" }, pull(), context(adapter))).toThrow(
        "Pull request #132 merged but reported no merge commit.",
      );
      expect(writes).toEqual([
        { kind: "merge", subject: "chore(merge): #132 Deepen the merge gate's script" },
      ]);
    }
  });

  it("fails a factory pull that closes no issue", () => {
    const { adapter } = actions();

    expect(() =>
      performStep({ kind: "merge" }, pull({ closing: [], body: null }), context(adapter)),
    ).toThrow("Pull request #132 closes no issue; cannot name the merge commit.");
  });

  it("performs no writes in a dry run", () => {
    const steps: MergeStep[] = [
      { kind: "wait", reason: "CI is still running on abc1234" },
      { kind: "requeue-review" },
      { kind: "fix", reason: "ci" },
      { kind: "escalate", reasons: ["CI failed on abc1234"] },
      { kind: "merge" },
    ];

    for (const step of steps) {
      const { adapter, writes } = actions();

      performStep(step, pull(), context(adapter, true));

      expect(writes, `step ${step.kind}`).toEqual([]);
    }
  });
});

describe("the gate's flow", () => {
  const at = "2026-11-09T09:10:00Z";
  const ciSuccess = [
    { headSha: HEAD_SHA, status: "completed", conclusion: "success", createdAt: at },
  ];
  const reviewPass = [
    {
      body: summaryComment({
        verdict: "pass",
        findings: [],
        mergeDanger: { door: "two-way", blastRadius: "local", reason: "one step, revertible" },
      }),
      createdAt: "2026-11-09T09:20:00Z",
    },
  ];

  it("escalates a green pull request with no risk label", () => {
    const { adapter, writes } = actions();
    const read = readMergeFacts(
      "owner/repo",
      "132",
      reader({
        pullOf: () => pull({ labels: [] }),
        ciRuns: () => ciSuccess,
        issueComments: () => reviewPass,
      }),
    );

    const step = mergeStep(read.facts);
    expect(step).toEqual({ kind: "escalate", reasons: ["no risk label"] });

    performStep(step, read.pull, context(adapter));

    expect(writes).toEqual([
      { kind: "comment", body: escalationComment(["no risk label"]) },
      { kind: "label", name: "ready-for-human" },
    ]);
  });

  it("sends a branch main's files moved under to the fix loop", () => {
    const { adapter, writes } = actions();
    const read = readMergeFacts(
      "owner/repo",
      "132",
      reader({
        changedFiles: () => ["apps/web/src/Game.tsx"],
        ciRuns: () => ciSuccess,
        issueComments: () => reviewPass,
        compareOf: () => ({
          mergeBase: "merge-base",
          mainAheadBy: 2,
          files: ["apps/web/src/Game.tsx"],
        }),
      }),
    );

    const step = mergeStep(read.facts);
    expect(step).toEqual({ kind: "fix", reason: "main-moved" });

    performStep(step, read.pull, context(adapter));

    expect(writes).toEqual([{ kind: "dispatchFix", reason: "main-moved" }]);
  });

  it("merges a branch that is only behind main, on files it does not touch", () => {
    const { adapter, writes } = actions();
    const read = readMergeFacts(
      "owner/repo",
      "132",
      reader({
        changedFiles: () => ["apps/web/src/Game.tsx"],
        ciRuns: () => ciSuccess,
        issueComments: () => reviewPass,
        compareOf: () => ({
          mergeBase: "merge-base",
          mainAheadBy: 2,
          files: ["apps/server/src/room.ts"],
        }),
      }),
    );

    const step = mergeStep(read.facts);
    expect(step).toEqual({ kind: "merge" });

    performStep(step, read.pull, context(adapter));

    expect(writes).toEqual([
      { kind: "merge", subject: "chore(merge): #132 Deepen the merge gate's script" },
      { kind: "commentOnIssue", issue: 132, body: "Merged in abc1234." },
      { kind: "closeIssue", issue: 132 },
    ]);
  });
});
