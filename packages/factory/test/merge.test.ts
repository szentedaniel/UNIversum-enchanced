import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FixReason } from "#fix/reasons.ts";
import { readMergeFacts, type MergeReader, type PullView } from "#merge/facts.ts";
import { mergeGate, waitForMergeability } from "#merge/merge.ts";
import { performStep, type MergeActions } from "#merge/perform.ts";
import { escalationComment, type FollowUpIssue } from "#merge/comment.ts";
import { mergeStep, type MergeStep } from "#merge/gates.ts";
import { summaryComment } from "#review/summary.ts";
import { RATE_LIMIT_WAITS_MS } from "#shared/github.ts";

const HEAD_SHA = "head-sha";

/** A rules `migrate.ts` whose chain holds one migration plus `entries`, as oxfmt writes them. */
const migrateChain = (...entries: readonly string[]): string =>
  [
    "const MIGRATIONS: Readonly<Record<number, (state: StoredState) => StoredState>> = {",
    "  1: (state) => ({ ...state, stateVersion: 2 }),",
    ...entries,
    "};",
    "",
    "export function migrate(stored: unknown): GameState {",
    "  return stored;",
    "}",
  ].join("\n");

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
  fixtureNames: () => undefined,
  issueComments: () => [],
  ...overrides,
});

/** A `gh` refusal as execSync throws it: the reason on stderr, the command in its message. */
const rateLimited = (): Error =>
  Object.assign(
    new Error(
      "Command failed: gh api repos/owner/repo/pulls/132/files\ngh: API rate limit exceeded for 1.2.3.4. (HTTP 403)\n",
    ),
    { stdout: "", stderr: "gh: API rate limit exceeded for 1.2.3.4. (HTTP 403)\n" },
  );

/** The GraphQL shape (`gh pr view`): the refusal names no HTTP status. */
const graphqlRateLimited = (): Error =>
  Object.assign(
    new Error(
      "Command failed: gh pr view 132 --repo owner/repo\nGraphQL: API rate limit exceeded for user ID 1.\n",
    ),
    { stdout: "", stderr: "GraphQL: API rate limit exceeded for user ID 1.\n" },
  );

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

    const facts = readMergeFacts(
      "owner/repo",
      "132",
      pull({ mergeStateStatus: "DIRTY" }),
      reader({
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

    expect(facts).toEqual({
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
      migration: undefined,
    });
  });

  it("reads the dependency maps at the merge base and the head", () => {
    const contents: Record<string, string> = {
      "package.json@merge-base": '{"dependencies":{"react":"^18.2.0"}}',
      "package.json@head-sha": '{"dependencies":{"react":"^19.0.0"}}',
    };

    const facts = readMergeFacts(
      "owner/repo",
      "132",
      pull(),
      reader({
        changedFiles: () => ["package.json", "apps/web/src/Game.tsx"],
        contentAt: (_repo, file, ref) => contents[`${file}@${ref}`],
      }),
    );

    expect(facts.dependencyChanges).toEqual([
      { file: "package.json", before: { react: "^18.2.0" }, after: { react: "^19.0.0" } },
    ]);
  });

  it("skips a package.json the pull request adds or removes", () => {
    const facts = readMergeFacts(
      "owner/repo",
      "132",
      pull(),
      reader({
        changedFiles: () => ["package.json"],
        contentAt: (_repo, _file, ref) => (ref === HEAD_SHA ? '{"dependencies":{}}' : undefined),
      }),
    );

    expect(facts.dependencyChanges).toEqual([]);
  });

  it("reads the migration's sources, at the merge base, main and the head", () => {
    const contents: Record<string, string> = {
      "packages/rules/src/state.ts@merge-base": "export const STATE_VERSION = 2;",
      "packages/rules/src/state.ts@main": "export const STATE_VERSION = 2;",
      "packages/rules/src/state.ts@head-sha": "export const STATE_VERSION = 3;",
      "packages/rules/src/migrate.ts@main": "main chain",
      "packages/rules/src/migrate.ts@head-sha": "head chain",
      "packages/rules/test/migrate.test.ts@head-sha": 'const snapshots = ["state-v3.json"];',
    };
    const listings: Record<string, string[]> = {
      main: ["state-v1.json", "state-v2.json"],
      "head-sha": ["state-v1.json", "state-v2.json", "state-v3.json"],
    };

    const facts = readMergeFacts(
      "owner/repo",
      "132",
      pull(),
      reader({
        changedFiles: () => [
          "packages/rules/src/migrate.ts",
          "packages/rules/test/fixtures/state-v3.json",
        ],
        contentAt: (_repo, file, ref) => contents[`${file}@${ref}`],
        fixtureNames: (_repo, ref) => listings[ref],
      }),
    );

    expect(facts.migration).toEqual({
      stateBase: "export const STATE_VERSION = 2;",
      stateMain: "export const STATE_VERSION = 2;",
      stateHead: "export const STATE_VERSION = 3;",
      migrateMain: "main chain",
      migrateHead: "head chain",
      testHead: 'const snapshots = ["state-v3.json"];',
      fixturesMain: ["state-v1.json", "state-v2.json"],
      fixturesHead: ["state-v1.json", "state-v2.json", "state-v3.json"],
      files: ["packages/rules/src/migrate.ts", "packages/rules/test/fixtures/state-v3.json"],
    });
  });

  it("reads nothing extra for a pull request outside the migration paths", () => {
    let listings = 0;
    const facts = readMergeFacts(
      "owner/repo",
      "132",
      pull(),
      reader({
        changedFiles: () => ["packages/rules/src/state.ts", "packages/rules/test/migrate.test.ts"],
        fixtureNames: () => {
          listings++;
          return [];
        },
      }),
    );

    expect(facts.migration).toBeUndefined();
    expect(listings).toBe(0);
  });
});

type Write =
  | { readonly kind: "label"; readonly name: string }
  | { readonly kind: "comment"; readonly body: string }
  | { readonly kind: "dispatchFix"; readonly reason: FixReason }
  | { readonly kind: "merge"; readonly subject: string }
  | { readonly kind: "commentOnIssue"; readonly issue: number; readonly body: string }
  | { readonly kind: "closeIssue"; readonly issue: number }
  | { readonly kind: "followUp"; readonly issue: FollowUpIssue };

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
    fileFollowUp: (issue) => void writes.push({ kind: "followUp", issue }),
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

    performStep({ kind: "merge", advisory: [] }, pull(), context(adapter));

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

  it("keeps a merge that landed when the follow-up issue is refused", () => {
    const { adapter, writes } = actions();
    const refusing: MergeActions = {
      ...adapter,
      fileFollowUp: () => {
        throw new Error("HTTP 502");
      },
    };

    expect(() =>
      performStep({ kind: "merge", advisory: ["A judgement call."] }, pull(), context(refusing)),
    ).not.toThrow();
    expect(writes.map((write) => write.kind)).toEqual(["merge", "commentOnIssue", "closeIssue"]);
  });

  it("files the advisory findings as one follow-up issue after the merge", () => {
    const { adapter, writes } = actions();
    const advisory = ["The helper duplicates `excerptOf`.", "The assertion is trivially true."];

    performStep({ kind: "merge", advisory }, pull(), context(adapter));

    const followUp = writes.at(-1);
    expect(followUp?.kind).toBe("followUp");
    if (followUp?.kind !== "followUp") return;
    expect(followUp.issue.title).toBe("Factory review follow-ups: #132");
    expect(followUp.issue.labels).toEqual(["needs-triage"]);
    expect(followUp.issue.body).toContain("#132");
    for (const finding of advisory) {
      expect(followUp.issue.body).toContain(`- ${finding}`);
    }
    // The merge comes first: an issue about a pull request that never merged
    // would be wrong, and a failed merge leaves no follow-up behind.
    expect(writes[0]).toEqual({
      kind: "merge",
      subject: "chore(merge): #132 Deepen the merge gate's script",
    });
  });

  it("reads the ticket the pull request's body closes when the API names none", () => {
    const { adapter, writes } = actions();

    performStep(
      { kind: "merge", advisory: [] },
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
      { kind: "merge", advisory: [] },
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

      expect(() => performStep({ kind: "merge", advisory: [] }, pull(), context(adapter))).toThrow(
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
      performStep(
        { kind: "merge", advisory: [] },
        pull({ closing: [], body: null }),
        context(adapter),
      ),
    ).toThrow("Pull request #132 closes no issue; cannot name the merge commit.");
  });

  it("performs no writes in a dry run", () => {
    const steps: MergeStep[] = [
      { kind: "wait", reason: "CI is still running on abc1234" },
      { kind: "requeue-review" },
      { kind: "fix", reason: "ci" },
      { kind: "escalate", reasons: ["CI failed on abc1234"] },
      { kind: "merge", advisory: ["An advisory finding."] },
    ];

    for (const step of steps) {
      const { adapter, writes } = actions();

      performStep(step, pull(), context(adapter, true));

      expect(writes, `step ${step.kind}`).toEqual([]);
    }
  });
});

const unread = (): never => {
  throw new Error("the gate read facts before its guard");
};

describe("mergeGate", () => {
  it("leaves a closed pull request alone after the pull read", () => {
    const { adapter, writes } = actions();
    let pulls = 0;

    mergeGate(
      "owner/repo",
      "132",
      reader({
        pullOf: () => {
          pulls += 1;
          return pull({ state: "CLOSED" });
        },
        changedFiles: unread,
        ciRuns: unread,
        compareOf: unread,
        contentAt: unread,
        issueComments: unread,
      }),
      adapter,
      false,
    );

    expect(pulls).toBe(1);
    expect(writes).toEqual([]);
  });

  it("leaves a human's pull request alone after the pull read", () => {
    const { adapter, writes } = actions();
    let pulls = 0;

    mergeGate(
      "owner/repo",
      "132",
      reader({
        pullOf: () => {
          pulls += 1;
          return pull({ headRefName: "feature/owner-change", labels: [], author: "szentedaniel" });
        },
        changedFiles: unread,
        ciRuns: unread,
        compareOf: unread,
        contentAt: unread,
        issueComments: unread,
      }),
      adapter,
      false,
    );

    expect(pulls).toBe(1);
    expect(writes).toEqual([]);
  });
});

describe("waitForMergeability", () => {
  it("waits out UNKNOWN until GitHub answers", () => {
    const statuses = ["UNKNOWN", "UNKNOWN", "CLEAN"];
    let reads = 0;
    let pauses = 0;

    const result = waitForMergeability(
      () => pull({ mergeStateStatus: statuses[reads++] ?? "CLEAN" }),
      () => {
        pauses += 1;
      },
    );

    expect(reads).toBe(3);
    expect(pauses).toBe(2);
    expect(result.mergeStateStatus).toBe("CLEAN");
  });

  it("gives up after six reads and decides on the last answer", () => {
    let reads = 0;
    let pauses = 0;

    const result = waitForMergeability(
      () => {
        reads += 1;
        return pull({ mergeStateStatus: "UNKNOWN" });
      },
      () => {
        pauses += 1;
      },
    );

    expect(reads).toBe(6);
    expect(pauses).toBe(5);
    expect(result.mergeStateStatus).toBe("UNKNOWN");
  });

  it("returns a known answer without pausing", () => {
    let pauses = 0;

    const result = waitForMergeability(
      () => pull({ mergeStateStatus: "DIRTY" }),
      () => {
        pauses += 1;
      },
    );

    expect(result.mergeStateStatus).toBe("DIRTY");
    expect(pauses).toBe(0);
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
    const subject = pull({ labels: [] });
    const facts = readMergeFacts(
      "owner/repo",
      "132",
      subject,
      reader({
        ciRuns: () => ciSuccess,
        issueComments: () => reviewPass,
      }),
    );

    const step = mergeStep(facts);
    expect(step).toEqual({ kind: "escalate", reasons: ["no risk label"] });

    performStep(step, subject, context(adapter));

    expect(writes).toEqual([
      { kind: "comment", body: escalationComment(["no risk label"]) },
      { kind: "label", name: "ready-for-human" },
    ]);
  });

  it("sends a branch main's files moved under to the fix loop", () => {
    const { adapter, writes } = actions();
    const subject = pull();
    const facts = readMergeFacts(
      "owner/repo",
      "132",
      subject,
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

    const step = mergeStep(facts);
    expect(step).toEqual({ kind: "fix", reason: "main-moved" });

    performStep(step, subject, context(adapter));

    expect(writes).toEqual([{ kind: "dispatchFix", reason: "main-moved" }]);
  });

  it("merges a branch that is only behind main, on files it does not touch", () => {
    const { adapter, writes } = actions();
    const subject = pull();
    const facts = readMergeFacts(
      "owner/repo",
      "132",
      subject,
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

    const step = mergeStep(facts);
    expect(step).toEqual({ kind: "merge", advisory: [] });

    performStep(step, subject, context(adapter));

    expect(writes).toEqual([
      { kind: "merge", subject: "chore(merge): #132 Deepen the merge gate's script" },
      { kind: "commentOnIssue", issue: 132, body: "Merged in abc1234." },
      { kind: "closeIssue", issue: 132 },
    ]);
  });

  it("retries a rate-limited read and decides normally", () => {
    const { adapter, writes } = actions();
    const pauses: number[] = [];
    let reads = 0;

    const outcome = mergeGate(
      "owner/repo",
      "132",
      reader({
        changedFiles: () => {
          reads += 1;
          if (reads <= 2) throw rateLimited();
          return [];
        },
        ciRuns: () => ciSuccess,
        issueComments: () => reviewPass,
      }),
      adapter,
      false,
      { pause: (ms) => pauses.push(ms) },
    );

    expect(outcome).toBe("decided");
    expect(pauses).toEqual([RATE_LIMIT_WAITS_MS[0], RATE_LIMIT_WAITS_MS[1]]);
    expect(writes).toEqual([
      { kind: "merge", subject: "chore(merge): #132 Deepen the merge gate's script" },
      { kind: "commentOnIssue", issue: 132, body: "Merged in abc1234." },
      { kind: "closeIssue", issue: 132 },
    ]);
  });

  it("retries a GraphQL refusal that names no HTTP status", () => {
    const { adapter, writes } = actions();
    const pauses: number[] = [];
    let reads = 0;

    const outcome = mergeGate(
      "owner/repo",
      "132",
      reader({
        pullOf: () => {
          reads += 1;
          if (reads === 1) throw graphqlRateLimited();
          return pull();
        },
        changedFiles: () => [],
        ciRuns: () => ciSuccess,
        issueComments: () => reviewPass,
      }),
      adapter,
      false,
      { pause: (ms) => pauses.push(ms) },
    );

    expect(outcome).toBe("decided");
    expect(reads).toBe(2);
    expect(pauses).toEqual([RATE_LIMIT_WAITS_MS[0]]);
    expect(writes).toEqual([
      { kind: "merge", subject: "chore(merge): #132 Deepen the merge gate's script" },
      { kind: "commentOnIssue", issue: 132, body: "Merged in abc1234." },
      { kind: "closeIssue", issue: 132 },
    ]);
  });

  it("leaves a rate-limited write for a later run instead of retrying it", () => {
    const { adapter, writes } = actions();
    const pauses: number[] = [];
    let merges = 0;

    const outcome = mergeGate(
      "owner/repo",
      "132",
      reader({ ciRuns: () => ciSuccess, issueComments: () => reviewPass }),
      {
        ...adapter,
        merge: () => {
          merges += 1;
          throw rateLimited();
        },
      },
      false,
      { pause: (ms) => pauses.push(ms) },
    );

    expect(outcome).toBe("rate-limited");
    expect(merges).toBe(1);
    expect(pauses).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("leaves a persistently rate-limited pull request for a later run", () => {
    const { adapter, writes } = actions();
    const pauses: number[] = [];

    const outcome = mergeGate(
      "owner/repo",
      "132",
      reader({
        changedFiles: () => {
          throw rateLimited();
        },
        ciRuns: () => ciSuccess,
        issueComments: () => reviewPass,
      }),
      adapter,
      false,
      { pause: (ms) => pauses.push(ms) },
    );

    expect(outcome).toBe("rate-limited");
    expect(pauses).toHaveLength(RATE_LIMIT_WAITS_MS.length);
    expect(writes).toEqual([]);
  });

  it("fails the step on an error that is no rate limit", () => {
    const { adapter, writes } = actions();
    const pauses: number[] = [];

    expect(() =>
      mergeGate(
        "owner/repo",
        "132",
        reader({
          changedFiles: () => {
            throw new Error(
              "Command failed: gh api repos/owner/repo/pulls/132/files\ngh: Not Found (HTTP 404)\n",
            );
          },
          ciRuns: () => ciSuccess,
          issueComments: () => reviewPass,
        }),
        adapter,
        false,
        { pause: (ms) => pauses.push(ms) },
      ),
    ).toThrow("Not Found");
    expect(pauses).toEqual([]);
    expect(writes).toEqual([]);
  });
});

describe("the gate's entry", () => {
  it("merges an advisory-only review and files one needs-triage follow-up", () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-merge-entry-"));
    const calls = join(dir, "gh-calls.log");
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in
  *mergeCommit*) echo "abc1234" ;;
  *"pr view"*)
    echo '{"number":132,"state":"OPEN","title":"Implement #132: deepen the merge gate script","body":"Closes #132","headRefName":"agent/issue-132-deepen-the-merge-gate","headRefOid":"head-sha","mergeStateStatus":"CLEAN","labels":["risk:low"],"closing":[132],"headCommittedAt":"2026-11-09T09:00:00Z","author":"universum-factory[bot]"}'
    ;;
  */pulls/132/files*) echo "apps/web/src/foo.ts" ;;
  */actions/workflows/ci.yml/runs*) echo '[{"headSha":"head-sha","status":"completed","conclusion":"success","createdAt":"2026-11-09T09:10:00Z"}]' ;;
  */compare/*) echo '{"mergeBase":"merge-base","mainAheadBy":0,"files":[]}' ;;
  */issues/132/comments*)
    printf '%s\\n' '{"body":"<!-- factory-review -->\\n## Factory review: changes requested\\n\\nThe reviewer committed the fixes it was sure of. These are the findings it left:\\n\\n- **Advisory:** The helper duplicates \`excerptOf\`.\\n- **Advisory:** The assertion is trivially true.\\n\\n**Merge danger:** two-way door, local blast radius. one factory step\\n","created_at":"2026-11-09T09:20:00Z"}'
    ;;
  *"issue view"*) echo "Deepen the merge gate script" ;;
esac
exit 0
`,
    );
    chmodSync(join(dir, "gh"), 0o755);

    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../src/merge/merge.ts", import.meta.url))],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env["PATH"] ?? ""}`,
          GH_REPO: "owner/repo",
          PR_NUMBER: "132",
          DRY_RUN: "",
        },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Merged in abc1234.");
    const commands = readFileSync(calls, "utf8").trim().split("\n");
    expect(commands.some((command) => command.startsWith("pr merge 132"))).toBe(true);
    const created = commands.find((command) => command.startsWith("issue create"));
    expect(created).toContain("--title Factory review follow-ups: #132");
    expect(created).toContain("--label needs-triage");
    const bodyFile = /--body-file (\S+)/u.exec(created ?? "")?.[1] ?? "";
    expect(readFileSync(bodyFile, "utf8")).toContain("- The helper duplicates `excerptOf`.");
    expect(readFileSync(bodyFile, "utf8")).toContain("#132");
  });

  it("merges a mechanically checked migration that gh reports as a one-way door", () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-merge-migration-"));
    const calls = join(dir, "gh-calls.log");
    const payload = (name: string, content: string): void => {
      writeFileSync(join(dir, name), content);
    };
    payload("state-base", "export const STATE_VERSION = 2;");
    payload("state-main", "export const STATE_VERSION = 2;");
    payload("state-head", "export const STATE_VERSION = 3;");
    payload("migrate-main", migrateChain());
    payload("migrate-head", migrateChain("  2: (state) => ({ ...state, stateVersion: 3 }),"));
    payload("test-head", 'const snapshots = ["state-v1.json", "state-v2.json", "state-v3.json"];');
    payload("fixtures-main", '["state-v1.json","state-v2.json"]');
    payload("fixtures-head", '["state-v1.json","state-v2.json","state-v3.json"]');
    writeFileSync(
      join(dir, "comments"),
      `{"body":${JSON.stringify(
        summaryComment({
          verdict: "pass",
          findings: [],
          mergeDanger: { door: "one-way", blastRadius: "wide", reason: "stored state" },
        }),
      )},"created_at":"2026-11-09T09:20:00Z"}\n`,
    );
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/sh
echo "$*" >> "${calls}"
case "$*" in
  *mergeCommit*) echo "abc1234" ;;
  *"pr view"*)
    echo '{"number":132,"state":"OPEN","title":"Implement #302: a migration","body":"Closes #302","headRefName":"agent/issue-302-migration","headRefOid":"head-sha","mergeStateStatus":"CLEAN","labels":["risk:high"],"closing":[302],"headCommittedAt":"2026-11-09T09:00:00Z","author":"universum-factory[bot]"}'
    ;;
  */pulls/132/files*)
    printf '%s\\n' "packages/rules/src/state.ts" "packages/rules/src/migrate.ts" "packages/rules/test/migrate.test.ts" "packages/rules/test/fixtures/state-v3.json"
    ;;
  */actions/workflows/ci.yml/runs*) echo '[{"headSha":"head-sha","status":"completed","conclusion":"success","createdAt":"2026-11-09T09:10:00Z"}]' ;;
  */compare/*) echo '{"mergeBase":"merge-base","mainAheadBy":0,"files":[]}' ;;
  */issues/132/comments*) cat "${dir}/comments" ;;
  *contents/*)
    case "$*" in
      *"state.ts?ref=merge-base"*) cat "${dir}/state-base" ;;
      *"state.ts?ref=main"*) cat "${dir}/state-main" ;;
      *"state.ts?ref=head-sha"*) cat "${dir}/state-head" ;;
      *"migrate.ts?ref=main"*) cat "${dir}/migrate-main" ;;
      *"migrate.ts?ref=head-sha"*) cat "${dir}/migrate-head" ;;
      *"migrate.test.ts?ref=head-sha"*) cat "${dir}/test-head" ;;
      *"fixtures/?ref=main"*) cat "${dir}/fixtures-main" ;;
      *"fixtures/?ref=head-sha"*) cat "${dir}/fixtures-head" ;;
    esac
    ;;
  *"issue view"*) echo "A migration" ;;
esac
exit 0
`,
    );
    chmodSync(join(dir, "gh"), 0o755);

    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../src/merge/merge.ts", import.meta.url))],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env["PATH"] ?? ""}`,
          GH_REPO: "owner/repo",
          PR_NUMBER: "132",
          DRY_RUN: "",
        },
      },
    );

    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Merged in abc1234.");
    const commands = readFileSync(calls, "utf8").trim().split("\n");
    expect(commands.some((command) => command.startsWith("pr merge 132"))).toBe(true);
    expect(
      commands.filter((command) => command.includes("contents/packages/rules/test/fixtures/")),
    ).toHaveLength(2);
  });

  it("exits green when the run cannot outlast the refusal, so no escalation runs", () => {
    const dir = mkdtempSync(join(tmpdir(), "factory-merge-entry-"));
    const calls = join(dir, "gh-calls.log");
    writeFileSync(
      join(dir, "gh"),
      `#!/bin/sh\necho "$*" >> "${calls}"\necho "gh: API rate limit exceeded for 1.2.3.4. (HTTP 403)" >&2\nexit 1\n`,
    );
    chmodSync(join(dir, "gh"), 0o755);
    // The waits are real seconds; a no-op sleep keeps this test fast.
    writeFileSync(join(dir, "sleep"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(dir, "sleep"), 0o755);

    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL("../src/merge/merge.ts", import.meta.url))],
      {
        encoding: "utf8",
        timeout: 60_000,
        env: {
          ...process.env,
          PATH: `${dir}:${process.env["PATH"] ?? ""}`,
          GH_REPO: "owner/repo",
          PR_NUMBER: "132",
          DRY_RUN: "",
        },
      },
    );

    expect(result.stdout).toContain("::warning::");
    expect(result.status).toBe(0);
    // Every attempt was refused and retried; the fourth found the schedule spent.
    expect(readFileSync(calls, "utf8").trim().split("\n")).toHaveLength(
      RATE_LIMIT_WAITS_MS.length + 1,
    );
  });
});
