import { describe, expect, it } from "vitest";
import { splitProblems, splitSchema, triageSchema, type Split } from "#intake/schema.ts";

const splitOf = (blockedBy: number[][]): Split => ({
  spec: "## Problem\n\nx",
  tickets: blockedBy.map((blocked, index) => ({
    title: `Ticket ${String(index)}`,
    body: `## What to build\n\n${String(index)}`,
    context: "## Implementation context (for implementer agents)",
    blockedBy: blocked,
  })),
});

describe("triageSchema", () => {
  it("accepts the three decisions, each with its payload", () => {
    expect(triageSchema.parse({ kind: "ready", context: "## Implementation context" })).toEqual({
      kind: "ready",
      context: "## Implementation context",
    });
    expect(triageSchema.parse({ kind: "needs-info", questions: ["Which browser?"] })).toEqual({
      kind: "needs-info",
      questions: ["Which browser?"],
    });
    expect(triageSchema.parse({ kind: "spec", spec: "## Problem\n\nx" })).toEqual({
      kind: "spec",
      spec: "## Problem\n\nx",
    });
  });

  it("rejects a decision without its payload", () => {
    expect(triageSchema.safeParse({ kind: "ready" }).success).toBe(false);
    expect(triageSchema.safeParse({ kind: "needs-info" }).success).toBe(false);
    expect(triageSchema.safeParse({ kind: "needs-info", questions: [] }).success).toBe(false);
    expect(triageSchema.safeParse({ kind: "spec", spec: "" }).success).toBe(false);
    expect(triageSchema.safeParse({ kind: "bugfix", context: "x" }).success).toBe(false);
  });
});

describe("splitSchema", () => {
  const ticket = { title: "A", body: "## What to build", context: "## Implementation context" };

  it("accepts a spec with one or more tickets", () => {
    expect(splitSchema.parse({ spec: "## Problem", tickets: [ticket] })).toEqual({
      spec: "## Problem",
      tickets: [{ ...ticket, blockedBy: [] }],
    });
  });

  it("defaults a missing blockedBy to no blockers", () => {
    const parsed = splitSchema.parse({ spec: "s", tickets: [ticket] });
    expect(parsed.tickets[0]?.blockedBy).toEqual([]);
  });

  it("rejects a spec with no tickets or a ticket without a body", () => {
    expect(splitSchema.safeParse({ spec: "s", tickets: [] }).success).toBe(false);
    expect(splitSchema.safeParse({ spec: "s", tickets: [{ ...ticket, body: "" }] }).success).toBe(
      false,
    );
  });
});

describe("splitProblems", () => {
  it("passes an acyclic plan, including a diamond", () => {
    expect(splitProblems(splitOf([[], [], [0, 1]]))).toEqual([]);
    expect(splitProblems(splitOf([[], [0], [0], [1, 2]]))).toEqual([]);
  });

  it("names a blockedBy index outside the ticket list", () => {
    expect(splitProblems(splitOf([[1]]))).toEqual(["tickets[0].blockedBy has 1, outside 0..0"]);
    expect(splitProblems(splitOf([[-1]]))).toEqual(["tickets[0].blockedBy has -1, outside 0..0"]);
  });

  it("names a ticket blocked by itself", () => {
    expect(splitProblems(splitOf([[], [1]]))).toEqual(["tickets[1] is blocked by itself"]);
  });

  it("names a two-ticket cycle", () => {
    expect(splitProblems(splitOf([[1], [0]]))).toEqual(["blockedBy forms a cycle: 0 → 1 → 0"]);
  });

  it("names a longer cycle", () => {
    expect(splitProblems(splitOf([[1], [2], [0]]))).toEqual([
      "blockedBy forms a cycle: 0 → 1 → 2 → 0",
    ]);
  });

  it("does not mistake a repeated edge for a cycle", () => {
    expect(splitProblems(splitOf([[], [0, 0]]))).toEqual([]);
  });

  it("reports every out-of-range index before looking for a cycle", () => {
    expect(splitProblems(splitOf([[3], [7]]))).toEqual([
      "tickets[0].blockedBy has 3, outside 0..1",
      "tickets[1].blockedBy has 7, outside 0..1",
    ]);
  });
});
