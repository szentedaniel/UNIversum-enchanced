import { describe, expect, it } from "vitest";
import { excerptOf } from "#fix/excerpt.ts";
import { fixReasonOf } from "#fix/reasons.ts";
import {
  fixDecision,
  fixPlan,
  fixRounds,
  mainMovedComment,
  mainMovedProblem,
  roundComment,
} from "#fix/rounds.ts";

describe("fixRounds", () => {
  it("counts the round markers, the highest number winning", () => {
    const comments = [
      { body: "Looks fine." },
      { body: `Some narration.\n\n${roundComment(1, "review")}` },
      { body: roundComment(2, "ci") },
    ];

    expect(fixRounds(comments)).toBe(2);
  });

  it("is zero before the first round", () => {
    expect(fixRounds([{ body: "LGTM" }])).toBe(0);
    expect(fixRounds([])).toBe(0);
  });
});

describe("fixDecision", () => {
  it("allows the two rounds the spec grants", () => {
    expect(fixDecision(0)).toEqual({ run: true, round: 1 });
    expect(fixDecision(1)).toEqual({ run: true, round: 2 });
  });

  it("stops after the second round and says why", () => {
    expect(fixDecision(2)).toEqual({
      run: false,
      reason: "the fix loop already ran 2 rounds",
    });
  });
});

describe("fixPlan", () => {
  it("runs the next round while the review asks for a fix", () => {
    expect(fixPlan(0, "review", false)).toEqual({ action: "run", round: 1 });
  });

  it("stands down for an advisory-only review, whatever the rounds", () => {
    expect(fixPlan(2, "review", true)).toEqual({ action: "merge-gate" });
    expect(fixPlan(0, "review", true)).toEqual({ action: "merge-gate" });
  });

  it("escalates a spent budget when a blocking finding brought it back", () => {
    expect(fixPlan(2, "review", false)).toEqual({
      action: "escalate",
      reason: "the fix loop already ran 2 rounds",
    });
  });

  it("keeps a red CI run on its rounds, whatever the last review said", () => {
    expect(fixPlan(1, "ci", true)).toEqual({ action: "run", round: 2 });
    expect(fixPlan(2, "ci", true)).toEqual({
      action: "escalate",
      reason: "the fix loop already ran 2 rounds",
    });
  });
});

describe("roundComment", () => {
  it("carries the hidden marker that counts it, and the reason", () => {
    const comment = roundComment(2, "review");

    expect(comment).toContain("<!-- factory-fix:round 2 -->");
    expect(comment).toContain("round 2 of 2");
    expect(comment).toContain("the review's findings");
    expect(fixRounds([{ body: comment }])).toBe(2);
  });

  it("names a failed CI run", () => {
    expect(roundComment(1, "ci")).toContain("a failed CI run");
  });
});

describe("mainMovedComment", () => {
  it("says main was merged without claiming a round", () => {
    const comment = mainMovedComment();

    expect(comment).toContain("main was merged into the branch");
    expect(fixRounds([{ body: comment }])).toBe(0);
  });
});

describe("mainMovedProblem", () => {
  it("tells omp to renumber a migration main took first, on both files", () => {
    const problem = mainMovedProblem();

    expect(problem).toContain("main moved");
    expect(problem).toContain("renumber the migration");
    expect(problem).toContain("packages/rules/src/migrate.ts");
    expect(problem).toContain("state-v<new>.json");
    expect(problem).toContain("packages/rules/test/migrate.test.ts");
  });
});

describe("fixReasonOf", () => {
  it("reads the reasons the workflows pass", () => {
    expect(fixReasonOf("ci")).toBe("ci");
    expect(fixReasonOf("review")).toBe("review");
    expect(fixReasonOf("main-moved")).toBe("main-moved");
    expect(fixReasonOf("other")).toBeUndefined();
  });
});

describe("excerptOf", () => {
  it("keeps a short log whole", () => {
    expect(excerptOf("one\ntwo\n")).toBe("one\ntwo");
  });

  it("keeps the tail, where the error is, and marks the cut", () => {
    const log = `${"noise\n".repeat(1000)}Error: expected 2 to be 1`;

    const excerpt = excerptOf(log, 100);

    expect(excerpt.startsWith("… (earlier output trimmed)\n")).toBe(true);
    expect(excerpt).toContain("Error: expected 2 to be 1");
    expect(excerpt.length).toBeLessThanOrEqual(100);
  });
});
