import { describe, expect, it } from "vitest";
import { canAutoMerge, type MergeFacts } from "#merge/gates.ts";
import { riskLabel } from "#review/merge-danger.ts";
import type { MergeDanger } from "#review/schema.ts";
import { summaryComment } from "#review/summary.ts";

const HEAD = "abc1234def5678";

/** The gate's facts for a review that rated this danger, outside a protected path. */
const factsFor = (danger: MergeDanger): MergeFacts => ({
  headSha: HEAD,
  headCommittedAt: "2026-11-09T10:00:00Z",
  labels: [riskLabel(danger)],
  ciRuns: [
    {
      headSha: HEAD,
      status: "completed",
      conclusion: "success",
      createdAt: "2026-11-09T10:10:00Z",
    },
  ],
  comments: [
    {
      body: summaryComment({ verdict: "pass", findings: [], mergeDanger: danger }),
      createdAt: "2026-11-09T10:20:00Z",
    },
  ],
  files: ["packages/protocol/src/messages.ts"],
  dependencyChanges: [],
  mergeState: "clean",
  mainAheadBy: 0,
  mainFiles: [],
  migration: undefined,
});

describe("riskLabel", () => {
  it("calls a two-way door with a local blast radius risk:low", () => {
    expect(
      riskLabel({ door: "two-way", blastRadius: "local", reason: "one step, revertible" }),
    ).toBe("risk:low");
  });

  it("escalates a wide blast radius", () => {
    expect(riskLabel({ door: "two-way", blastRadius: "wide", reason: "shared behaviour" })).toBe(
      "risk:high",
    );
  });

  it("escalates a one-way door", () => {
    expect(riskLabel({ door: "one-way", blastRadius: "local", reason: "state migration" })).toBe(
      "risk:high",
    );
  });

  it("escalates a one-way door with a wide blast radius", () => {
    expect(riskLabel({ door: "one-way", blastRadius: "wide", reason: "protocol break" })).toBe(
      "risk:high",
    );
  });
});

describe("the merge-danger decision", () => {
  it("auto-merges a two-way additive protocol change outside a protected path", () => {
    const danger: MergeDanger = {
      door: "two-way",
      blastRadius: "wide",
      reason: "additive protocol change",
    };

    // The blast radius is reported as it is, so the label escalates; the gate
    // reads the door off the summary and merges the revertible change anyway.
    expect(riskLabel(danger)).toBe("risk:high");
    expect(canAutoMerge(factsFor(danger))).toEqual({ merge: true, reasons: [] });
  });
});
