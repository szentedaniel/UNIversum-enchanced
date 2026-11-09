import { describe, expect, it } from "vitest";
import {
  appendLog,
  branchOf,
  commitSubjectOf,
  duplicateOf,
  isStandardsPath,
  isWorkflowPath,
  LOG_HEADER,
  logSection,
  patchPaths,
  planWrites,
  slugOf,
  unfencePatch,
} from "#retro/plan.ts";
import { retroSchema, type Finding } from "#retro/schema.ts";

const finding = (fix: Finding["fix"], overrides: Partial<Finding> = {}): Finding => ({
  problem: "The reviewer rewrites the money formatter on every pull request.",
  evidence: ["#101 review: the reviewer committed a formatter fix.", "#102 review: the same fix."],
  severity: "medium",
  fix,
  ...overrides,
});

const issueFix = (title: string): Finding["fix"] => ({
  kind: "issue",
  title,
  body: "## What to build\n\nUse `formatMoney` in the money formatter.",
});

const plan = (findings: Finding[], overrides: { maxWrites?: number } = {}) =>
  planWrites({
    findings,
    existing: [{ number: 110, title: "Factory: already open" }],
    date: "2026-11-09",
    maxWrites: overrides.maxWrites ?? 3,
  });

const standardsPatch = `diff --git a/CODING_STANDARDS.md b/CODING_STANDARDS.md
--- a/CODING_STANDARDS.md
+++ b/CODING_STANDARDS.md
@@ -1,1 +1,2 @@
 # Coding standards
+Money goes through \`formatMoney\`.
`;

const codePatch = `diff --git a/apps/web/src/format.ts b/apps/web/src/format.ts
--- a/apps/web/src/format.ts
+++ b/apps/web/src/format.ts
@@ -1,1 +1,1 @@
-export const money = (value: number): string => String(value);
+export const money = (value: number): string => value.toFixed(0);
`;

const workflowPatch = `diff --git a/.github/workflows/ci.yml b/.github/workflows/ci.yml
--- a/.github/workflows/ci.yml
+++ b/.github/workflows/ci.yml
@@ -1,1 +1,2 @@
 name: CI
+# The retro's proposed check.
`;

describe("retroSchema", () => {
  it("parses the answer the prompt asks for, one fix kind per finding", () => {
    const answer = retroSchema.parse({
      findings: [
        finding(issueFix("Express the money through one helper")),
        finding({
          kind: "standards-pr",
          title: "Name the formatter",
          body: "Why.",
          patch: standardsPatch,
        }),
        finding({
          kind: "workflow-issue",
          title: "Add the check",
          body: "Why.",
          patch: workflowPatch,
        }),
        finding({ kind: "none" }),
      ],
      logEntry: ["The reviewer's money fixes are a standards gap."],
    });

    expect(answer.findings.map((item) => item.fix.kind)).toEqual([
      "issue",
      "standards-pr",
      "workflow-issue",
      "none",
    ]);
  });

  it("keeps the findings when the model forgets the log entry", () => {
    const answer = retroSchema.parse({ findings: [finding(issueFix("A ticket"))] });

    expect(answer.logEntry).toEqual([]);
  });

  it("refuses a fix kind the script cannot write", () => {
    expect(() =>
      retroSchema.parse({
        findings: [
          {
            problem: "A fix the script has no writer for.",
            evidence: ["#101 review: something."],
            severity: "low",
            fix: { kind: "comment" },
          },
        ],
        logEntry: [],
      }),
    ).toThrow(/invalid/iu);
  });
});

describe("duplicateOf", () => {
  const open = [
    { number: 110, title: "Factory: the reviewer keeps rewriting the money formatter" },
  ];

  it("matches the same title regardless of case and punctuation", () => {
    expect(
      duplicateOf("factory: the reviewer keeps rewriting the MONEY formatter", open)?.number,
    ).toBe(110);
  });

  it("lets a different title through", () => {
    expect(duplicateOf("Factory: name the money helper", open)).toBeUndefined();
  });
});

describe("patchPaths", () => {
  it("reads the paths a unified diff touches", () => {
    expect(patchPaths(standardsPatch)).toEqual(["CODING_STANDARDS.md"]);
  });

  it("knows a deletion's path too", () => {
    const deletion = `diff --git a/docs/agents/old.md b/docs/agents/old.md
--- a/docs/agents/old.md
+++ /dev/null
@@ -1,1 +0,0 @@
-gone
`;
    expect(patchPaths(deletion)).toEqual(["docs/agents/old.md"]);
  });
});

describe("unfencePatch", () => {
  it("strips a fence the model added around the diff", () => {
    expect(unfencePatch(`\`\`\`diff\n${standardsPatch}\`\`\``)).toBe(standardsPatch.trim());
  });

  it("leaves a bare diff alone", () => {
    expect(unfencePatch(standardsPatch)).toBe(standardsPatch.trim());
  });
});

describe("isStandardsPath", () => {
  it("allows the standards, the protocol, the prompts and the ADRs", () => {
    expect(isStandardsPath("CODING_STANDARDS.md")).toBe(true);
    expect(isStandardsPath("docs/agents/implementer.md")).toBe(true);
    expect(isStandardsPath("packages/factory/src/fix/prompt.md")).toBe(true);
    expect(isStandardsPath("docs/adr/0006-retro.md")).toBe(true);
  });

  it("refuses code, the log and the handoff notes", () => {
    expect(isStandardsPath("apps/web/src/format.ts")).toBe(false);
    expect(isStandardsPath("docs/agents/factory-log.md")).toBe(false);
    expect(isStandardsPath("docs/agents/handoff/ticket-90.md")).toBe(false);
  });
});

describe("isWorkflowPath", () => {
  it("is the workflows directory only", () => {
    expect(isWorkflowPath(".github/workflows/ci.yml")).toBe(true);
    expect(isWorkflowPath("packages/factory/src/retro/collect.ts")).toBe(false);
  });
});

describe("planWrites", () => {
  it("opens a ready-for-agent ticket with the implementation context", () => {
    const [write] = plan([finding(issueFix("Write the money through one helper"))]).writes;

    expect(write).toMatchObject({ kind: "issue", title: "Write the money through one helper" });
    expect(write?.body).toContain("## Implementation context (for implementer agents)");
    expect(write?.body).toContain("#101 review: the reviewer committed a formatter fix.");
  });

  it("opens a standards pull request on a dated branch", () => {
    const [write] = plan([
      finding({
        kind: "standards-pr",
        title: "Name the money formatter",
        body: "Why.",
        patch: standardsPatch,
      }),
    ]).writes;

    expect(write).toMatchObject({
      kind: "standards-pr",
      branch: branchOf("2026-11-09", "Name the money formatter"),
      patch: standardsPatch.trim(),
    });
    expect(write?.body).toContain("protected path");
  });

  it("proposes a workflow change as an issue with the patch inline", () => {
    const [write] = plan([
      finding({
        kind: "workflow-issue",
        title: "Add the missing check",
        body: "Why.",
        patch: workflowPatch,
      }),
    ]).writes;

    expect(write).toMatchObject({ kind: "workflow-issue" });
    expect(write?.body).toContain("```diff");
    expect(write?.body).toContain("name: CI");
  });

  it("writes nothing for a one-off", () => {
    const answer = plan([finding({ kind: "none" })]);

    expect(answer.writes).toEqual([]);
    expect(answer.skipped).toEqual([]);
  });

  it("skips what an open issue already proposes", () => {
    const answer = plan([finding(issueFix("Factory: already open"))]);

    expect(answer.writes).toEqual([]);
    expect(answer.skipped).toEqual([`already proposed: #110 "Factory: already open"`]);
  });

  it("skips a standards patch that touches code", () => {
    const answer = plan([
      finding({ kind: "standards-pr", title: "Fix the formatter", body: "Why.", patch: codePatch }),
    ]);

    expect(answer.writes).toEqual([]);
    expect(answer.skipped[0]).toContain("apps/web/src/format.ts");
  });

  it("skips a workflow patch that touches anything outside the workflows", () => {
    const answer = plan([
      finding({ kind: "workflow-issue", title: "Change the code", body: "Why.", patch: codePatch }),
    ]);

    expect(answer.writes).toEqual([]);
    expect(answer.skipped[0]).toContain("not a workflow path");
  });

  it("stops at the write cap and says what it left for tomorrow", () => {
    const answer = plan(
      ["One", "Two", "Three", "Four"].map((name) => finding(issueFix(`Ticket ${name}`))),
    );

    expect(answer.writes).toHaveLength(3);
    expect(answer.skipped).toEqual(['write cap (3) reached: "Ticket Four"']);
  });
});

describe("commitSubjectOf", () => {
  it("keeps the subject a conventional commit under the length limit", () => {
    const subject = commitSubjectOf(
      "Name the money formatter and make every price in the codebase go through the one helper",
    );

    expect(subject.startsWith("docs(factory): ")).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(100);
    expect(subject.endsWith(".")).toBe(false);
  });
});

describe("slugOf and branchOf", () => {
  it("turns a title into a branch-safe slug", () => {
    expect(slugOf("Factory: the reviewer keeps rewriting `money`!")).toBe(
      "factory-the-reviewer-keeps-rewriting-money",
    );
    expect(branchOf("2026-11-09", "Name the formatter")).toBe(
      "retro/2026-11-09-name-the-formatter",
    );
  });
});

describe("the log", () => {
  it("writes a section with the bullets, or the one line a quiet day gets", () => {
    expect(logSection("2026-11-09", ["Opened issue #120: one helper"])).toBe(
      "## 2026-11-09\n\n- Opened issue #120: one helper\n",
    );
    expect(logSection("2026-11-09", [])).toContain("- Nothing new.");
    expect(logSection("2026-11-09", ["a line\nand another"])).toContain("- a line and another");
  });

  it("starts the file with the header and appends the next day under it", () => {
    const first = appendLog(undefined, "2026-11-09", ["One."]);
    expect(first.startsWith(LOG_HEADER)).toBe(true);
    expect(first).toContain("## 2026-11-09");

    const second = appendLog(first, "2026-11-10", ["Two."]);
    expect(second.indexOf("## 2026-11-10")).toBeGreaterThan(second.indexOf("## 2026-11-09"));
    expect(second).toContain("- Two.");
  });
});
