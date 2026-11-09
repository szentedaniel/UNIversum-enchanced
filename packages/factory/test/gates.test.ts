import { describe, expect, it } from "vitest";
import {
  canAutoMerge,
  ciState,
  dependencyMap,
  isProtectedPath,
  majorBumps,
  majorOf,
  isFactoryPull,
  mergeStep,
  mergeSubjectOf,
  needsMain,
  protectedPaths,
} from "#merge/gates.ts";
import type { CiRun, MergeFacts } from "#merge/gates.ts";
import { summaryComment } from "#review/summary.ts";

describe("protected paths", () => {
  it("names the spec's protected paths", () => {
    expect(protectedPaths([".github/workflows/ci.yml"])).toEqual([".github/"]);
    expect(protectedPaths(["packages/factory/src/merge/gates.ts"])).toEqual(["packages/factory/"]);
    expect(protectedPaths(["CODING_STANDARDS.md"])).toEqual(["CODING_STANDARDS.md"]);
    expect(protectedPaths(["AGENTS.md"])).toEqual(["AGENTS.md"]);
    expect(protectedPaths(["CLAUDE.md"])).toEqual(["CLAUDE.md"]);
    expect(protectedPaths(["docs/agents/factory.md"])).toEqual(["docs/agents/"]);
    expect(protectedPaths(["docs/adr/0006-the-merge-gate.md"])).toEqual(["docs/adr/"]);
    expect(protectedPaths(["packages/rules/src/migrate.ts"])).toEqual([
      "packages/rules/src/migrate.ts",
    ]);
    expect(protectedPaths(["packages/rules/test/fixtures/state-v3.json"])).toEqual([
      "packages/rules/test/fixtures/",
    ]);
  });

  it("lets the handoff notes through: every implementer writes them", () => {
    const files = ["docs/agents/handoff/ticket-87.md", "docs/agents/handoff/INDEX.md"];

    expect(files.filter(isProtectedPath)).toEqual([]);
    expect(protectedPaths(files)).toEqual([]);
  });

  it("leaves ordinary app, package and docs files alone", () => {
    const files = [
      "apps/web/src/Game.tsx",
      "packages/rules/src/apply.ts",
      "docs/research/isometric-rendering.md",
      "packages/rules/src/migrate.test.ts",
      "docs/agents.md",
    ];

    expect(files.filter(isProtectedPath)).toEqual([]);
  });

  it("lists each touched path once, in the spec's order", () => {
    const files = [
      "docs/agents/handoff/ticket-88.md",
      "docs/adr/0004-rules-engine-times-the-playback.md",
      ".github/workflows/ci.yml",
      ".github/workflows/factory-merge.yml",
      "packages/factory/package.json",
    ];

    expect(protectedPaths(files)).toEqual([".github/", "packages/factory/", "docs/adr/"]);
  });
});

describe("dependency majors", () => {
  it("reads a major from the range forms package.json uses", () => {
    expect(majorOf("^1.2.3")).toBe(1);
    expect(majorOf("~0.4.2")).toBe(4);
    expect(majorOf("0.0.5")).toBe(5);
    expect(majorOf(">=18 <19")).toBe(18);
    expect(majorOf("npm:foo@2.0.0")).toBe(2);
  });

  it("has no major to compare for a catalog, workspace or tag version", () => {
    expect(majorOf("catalog:")).toBeUndefined();
    expect(majorOf("workspace:*")).toBeUndefined();
    expect(majorOf("latest")).toBeUndefined();
  });

  it("reads every dependency field of a package.json", () => {
    const map = dependencyMap({
      name: "x",
      dependencies: { react: "^19.0.0" },
      devDependencies: { vitest: "catalog:" },
      peerDependencies: { zod: "^3.25.0" },
      optionalDependencies: { fsevents: "~2.3.3" },
      scripts: { test: "vitest run" },
    });

    expect(map).toEqual({
      react: "^19.0.0",
      vitest: "catalog:",
      zod: "^3.25.0",
      fsevents: "~2.3.3",
    });
  });

  it("flags a dependency whose major changed and leaves the rest", () => {
    const bumps = majorBumps([
      {
        file: "package.json",
        before: { react: "^18.2.0", vitest: "^5.0.0", zod: "catalog:" },
        after: { react: "^19.0.0", vitest: "^5.1.0", zod: "^4.0.0" },
      },
    ]);

    expect(bumps.map((bump) => [bump.name, bump.from, bump.to])).toEqual([
      ["react", "^18.2.0", "^19.0.0"],
    ]);
  });

  it("flags a 0.x minor bump and not a patch bump", () => {
    const bumps = majorBumps([
      {
        file: "packages/web/package.json",
        before: { a: "^0.4.1", b: "^0.4.1" },
        after: { a: "^0.5.0", b: "^0.4.9" },
      },
    ]);

    expect(bumps.map((bump) => bump.name)).toEqual(["a"]);
  });

  it("does not flag an added or removed dependency: no earlier major changed", () => {
    const bumps = majorBumps([
      {
        file: "package.json",
        before: { removed: "^1.0.0" },
        after: { added: "^9.0.0" },
      },
    ]);

    expect(bumps).toEqual([]);
  });
});

const HEAD = "abc1234def5678";

const ciRun = (overrides: Partial<CiRun> = {}): CiRun => ({
  headSha: HEAD,
  status: "completed",
  conclusion: "success",
  createdAt: "2026-11-09T10:10:00Z",
  ...overrides,
});

const reviewComment = (
  verdict: "pass" | "changes-requested",
  createdAt = "2026-11-09T10:20:00Z",
) => ({
  body: summaryComment({
    verdict,
    findings: [],
    mergeDanger: { door: "two-way", blastRadius: "local", reason: "one step, revertible" },
  }),
  createdAt,
});

const facts = (overrides: Partial<MergeFacts> = {}): MergeFacts => ({
  headSha: HEAD,
  headCommittedAt: "2026-11-09T10:00:00Z",
  labels: ["risk:low"],
  ciRuns: [ciRun()],
  comments: [reviewComment("pass")],
  files: ["apps/web/src/foo.ts"],
  dependencyChanges: [],
  mergeState: "clean",
  mainAheadBy: 0,
  mainFiles: [],
  ...overrides,
});

describe("ciState", () => {
  it("reads the newest run on the head commit", () => {
    const runs = [
      ciRun({ createdAt: "2026-11-09T10:05:00Z", conclusion: "failure" }),
      ciRun({ createdAt: "2026-11-09T10:20:00Z" }),
    ];

    expect(ciState(runs, HEAD)).toBe("success");
  });

  it("is pending while the head's newest run has not completed", () => {
    expect(ciState([ciRun({ status: "in_progress", conclusion: null })], HEAD)).toBe("pending");
  });

  it("is missing when no run matches the head", () => {
    expect(ciState([ciRun({ headSha: "other" })], HEAD)).toBe("missing");
  });

  it("is failure for any conclusion other than success", () => {
    expect(ciState([ciRun({ conclusion: "cancelled" })], HEAD)).toBe("failure");
  });
});

describe("canAutoMerge", () => {
  it("merges when CI, the review, the risk label and the paths all hold", () => {
    expect(canAutoMerge(facts())).toEqual({ merge: true, reasons: [] });
  });

  it("waits on CI: only success on the head sha passes", () => {
    expect(canAutoMerge(facts({ ciRuns: [ciRun({ conclusion: "failure" })] })).reasons).toEqual([
      "CI failed on abc1234",
    ]);
    expect(canAutoMerge(facts({ ciRuns: [] })).reasons).toEqual(["CI is missing on abc1234"]);
    expect(
      canAutoMerge(facts({ ciRuns: [ciRun({ status: "queued", conclusion: null })] })).reasons,
    ).toEqual(["CI is still running on abc1234"]);
  });

  it("refuses a changes-requested review", () => {
    const gate = canAutoMerge(facts({ comments: [reviewComment("changes-requested")] }));

    expect(gate.reasons).toEqual(["the newest review asked for changes"]);
  });

  it("refuses a review older than the head commit: a push needs a new review", () => {
    const gate = canAutoMerge(facts({ comments: [reviewComment("pass", "2026-11-09T09:59:00Z")] }));

    expect(gate.reasons).toEqual(["the newest review predates the head commit"]);
  });

  it("refuses when no review carries the marker", () => {
    const gate = canAutoMerge(
      facts({ comments: [{ body: "LGTM", createdAt: "2026-11-09T10:20:00Z" }] }),
    );

    expect(gate.reasons).toEqual(["no factory review comment yet"]);
  });

  it("requires risk:low", () => {
    expect(canAutoMerge(facts({ labels: [] })).reasons).toEqual(["no risk label"]);
    expect(canAutoMerge(facts({ labels: ["risk:low", "risk:high"] })).reasons).toEqual([
      "both risk:low and risk:high are set",
    ]);
  });

  it("names the reviewer's one-way door or wide blast radius as the reason", () => {
    const oneWay = {
      body: summaryComment({
        verdict: "pass",
        findings: [],
        mergeDanger: { door: "one-way", blastRadius: "local", reason: "a state migration" },
      }),
      createdAt: "2026-11-09T10:20:00Z",
    };
    expect(canAutoMerge(facts({ labels: ["risk:high"], comments: [oneWay] })).reasons).toEqual([
      "one-way door: a state migration",
    ]);

    const wide = {
      body: summaryComment({
        verdict: "pass",
        findings: [],
        mergeDanger: { door: "two-way", blastRadius: "wide", reason: "spans two packages" },
      }),
      createdAt: "2026-11-09T10:20:00Z",
    };
    expect(canAutoMerge(facts({ labels: ["risk:high"], comments: [wide] })).reasons).toEqual([
      "wide blast radius: spans two packages",
    ]);
  });

  it("refuses a protected path, and lets the handoff notes through", () => {
    expect(canAutoMerge(facts({ files: [".github/workflows/ci.yml"] })).reasons).toEqual([
      "touches .github/",
    ]);
    expect(
      canAutoMerge(
        facts({
          files: ["docs/agents/handoff/ticket-87.md", "docs/agents/handoff/INDEX.md"],
        }),
      ),
    ).toEqual({ merge: true, reasons: [] });
  });

  it("refuses a dependency major change", () => {
    const gate = canAutoMerge(
      facts({
        dependencyChanges: [
          { file: "package.json", before: { react: "^18.2.0" }, after: { react: "^19.0.0" } },
        ],
      }),
    );

    expect(gate.reasons).toEqual(["dependency major: react ^18.2.0 → ^19.0.0"]);
  });

  it("lists every reason that holds", () => {
    const gate = canAutoMerge(
      facts({
        labels: [],
        files: ["packages/factory/src/merge/gates.ts", "AGENTS.md"],
        dependencyChanges: [
          { file: "package.json", before: { zod: "^3.25.0" }, after: { zod: "^4.0.0" } },
        ],
      }),
    );

    expect(gate.reasons).toEqual([
      "no risk label",
      "touches packages/factory/",
      "touches AGENTS.md",
      "dependency major: zod ^3.25.0 → ^4.0.0",
    ]);
  });
});

describe("mergeStep", () => {
  it("merges when every gate holds", () => {
    expect(mergeStep(facts())).toEqual({ kind: "merge" });
  });

  it("waits while a review is queued", () => {
    expect(mergeStep(facts({ labels: ["risk:low", "agent:review"] }))).toEqual({
      kind: "wait",
      reason: "a review is queued (agent:review)",
    });
  });

  it("does not merge, or comment again, once a human has it", () => {
    expect(mergeStep(facts({ labels: ["risk:low", "ready-for-human"] }))).toEqual({
      kind: "wait",
      reason: "already waiting for a human (ready-for-human)",
    });
    expect(mergeStep(facts({ labels: ["risk:low", "agent:blocked"] }))).toEqual({
      kind: "wait",
      reason: "the pull request is blocked (agent:blocked)",
    });
  });

  it("sends the fix loop after main when the branch conflicts or shares files with it", () => {
    expect(mergeStep(facts({ mergeState: "dirty" }))).toEqual({
      kind: "fix",
      reason: "main-moved",
    });
    expect(
      mergeStep(facts({ mainAheadBy: 2, mainFiles: ["apps/web/src/foo.ts", "README.md"] })),
    ).toEqual({ kind: "fix", reason: "main-moved" });
  });

  it("merges a branch that is only behind main, on files it does not touch", () => {
    expect(mergeStep(facts({ mainAheadBy: 2, mainFiles: ["apps/server/src/bar.ts"] }))).toEqual({
      kind: "merge",
    });
    expect(
      needsMain(
        facts({
          mainAheadBy: 1,
          files: ["apps/web/src/foo.ts", "docs/agents/handoff/INDEX.md"],
          mainFiles: [".github/workflows/ci.yml", "docs/agents/handoff/INDEX.md"],
        }),
      ),
    ).toBe(false);
  });

  it("sends the fix loop after main even when main changed workflows", () => {
    const step = mergeStep(
      facts({
        mainAheadBy: 1,
        mainFiles: [".github/workflows/ci.yml", "apps/web/src/foo.ts"],
      }),
    );

    expect(step).toEqual({ kind: "fix", reason: "main-moved" });
  });

  it("waits for CI, leaving a failed run to the fix loop", () => {
    expect(mergeStep(facts({ ciRuns: [ciRun({ status: "queued", conclusion: null })] }))).toEqual({
      kind: "wait",
      reason: "CI is still running on abc1234",
    });
    expect(mergeStep(facts({ ciRuns: [ciRun({ conclusion: "failure" })] }))).toEqual({
      kind: "wait",
      reason: "CI failed on abc1234",
    });
  });

  it("waits for the first review", () => {
    expect(mergeStep(facts({ comments: [] }))).toEqual({
      kind: "wait",
      reason: "no factory review comment yet",
    });
    expect(mergeStep(facts({ comments: [reviewComment("changes-requested")] }))).toEqual({
      kind: "wait",
      reason: "the newest review asked for changes",
    });
  });

  it("re-queues a review when the head moved after it", () => {
    expect(mergeStep(facts({ comments: [reviewComment("pass", "2026-11-09T09:00:00Z")] }))).toEqual(
      {
        kind: "requeue-review",
      },
    );
  });

  it("escalates the deterministic gate reasons", () => {
    expect(mergeStep(facts({ files: [".github/workflows/ci.yml"] }))).toEqual({
      kind: "escalate",
      reasons: ["touches .github/"],
    });
  });
});

describe("isFactoryPull", () => {
  it("recognises the implementer's branches and factory-labelled pull requests", () => {
    expect(isFactoryPull("agent/issue-87-merge-gate", [])).toBe(true);
    expect(isFactoryPull("ticket/87-merge-gate", ["factory"])).toBe(true);
  });

  it("leaves the owner's own branches alone", () => {
    expect(isFactoryPull("main", ["risk:low"])).toBe(false);
    expect(isFactoryPull("fix/typo", [])).toBe(false);
  });

  it("takes Dependabot's own branch, only from Dependabot", () => {
    expect(isFactoryPull("dependabot/npm_and_yarn/vitest-5.0.6", [], "dependabot[bot]")).toBe(true);
    // A branch can be named anything; the author is what makes it Dependabot's.
    expect(isFactoryPull("dependabot/npm_and_yarn/vitest-5.0.6", [], "szentedaniel")).toBe(false);
    expect(isFactoryPull("agent/issue-91-maintenance", [], "dependabot[bot]")).toBe(true);
  });
});

describe("mergeSubjectOf", () => {
  const dependabot = {
    number: 97,
    title: "build(deps): Bump vitest from 5.0.5 to 5.0.6",
    ticket: undefined,
    headRefName: "dependabot/npm_and_yarn/vitest-5.0.6",
    author: "dependabot[bot]",
  };

  it("names the ticket a factory pull closes, by the ticket's title", () => {
    expect(
      mergeSubjectOf({
        ...dependabot,
        title: "Implement #91: Weekly maintenance",
        ticket: { number: 91, title: "Factory: weekly maintenance" },
        headRefName: "agent/issue-91-maintenance",
        author: "universum-factory[bot]",
      }),
    ).toBe("chore(merge): #91 Factory: weekly maintenance");
  });

  it("names a dependency bump by its pull request, which closes no ticket", () => {
    expect(mergeSubjectOf(dependabot)).toBe(
      "chore(merge): #97 build(deps): Bump vitest from 5.0.5 to 5.0.6",
    );
  });

  it("still refuses a factory pull that closes no issue", () => {
    expect(
      mergeSubjectOf({
        number: 95,
        title: "A factory pull with no ticket",
        ticket: undefined,
        headRefName: "agent/issue-95-something",
        author: "universum-factory[bot]",
      }),
    ).toBeUndefined();
  });
});
