import { describe, expect, it } from "vitest";
import { summaryComment } from "#review/summary.ts";
import { REVIEW_MARKER } from "#review/window.ts";

describe("summaryComment", () => {
  it("carries the hidden marker the quota counts, plus the verdict", () => {
    const comment = summaryComment({
      verdict: "pass",
      findings: [],
      mergeDanger: { door: "two-way", blastRadius: "local", reason: "one step, revertible" },
    });

    expect(comment.startsWith(REVIEW_MARKER)).toBe(true);
    expect(comment).toContain("## Factory review: pass");
  });

  it("lists the findings the reviewer could not fix", () => {
    const comment = summaryComment({
      verdict: "changes-requested",
      findings: ["`apps/web/src/foo.ts`: the retry has no cap.", "No test pins the empty list."],
      mergeDanger: { door: "one-way", blastRadius: "wide", reason: "state migration" },
    });

    expect(comment).toContain("## Factory review: changes requested");
    expect(comment).toContain("- `apps/web/src/foo.ts`: the retry has no cap.");
    expect(comment).toContain("- No test pins the empty list.");
  });

  it("says so when the reviewer fixed everything", () => {
    const comment = summaryComment({
      verdict: "pass",
      findings: [],
      mergeDanger: { door: "two-way", blastRadius: "local", reason: "docs only" },
    });

    expect(comment).toContain("- None: the reviewer fixed every finding it reported.");
  });

  it("states the merge danger in the /pr skill's wording", () => {
    const comment = summaryComment({
      verdict: "pass",
      findings: [],
      mergeDanger: { door: "one-way", blastRadius: "wide", reason: "touches the protocol" },
    });

    expect(comment).toContain("**Merge danger:** one-way door, wide blast radius. touches the protocol");
  });
});
