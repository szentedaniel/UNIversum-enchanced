import { describe, expect, it } from "vitest";
import {
  mergeDangerOf,
  newestMarkerComment,
  reviewVerdictOf,
  summaryComment,
} from "#review/summary.ts";
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

    expect(comment).toContain(
      "**Merge danger:** one-way door, wide blast radius. touches the protocol",
    );
  });
});

describe("reading a review comment", () => {
  const pass = summaryComment({
    verdict: "pass",
    findings: [],
    mergeDanger: { door: "two-way", blastRadius: "local", reason: "one step, revertible" },
  });
  const changes = summaryComment({
    verdict: "changes-requested",
    findings: ["No test pins the empty list."],
    mergeDanger: { door: "one-way", blastRadius: "wide", reason: "touches the protocol" },
  });

  it("reads back the verdict the summary writes", () => {
    expect(reviewVerdictOf(pass)).toBe("pass");
    expect(reviewVerdictOf(changes)).toBe("changes-requested");
  });

  it("ignores a comment without the hidden marker", () => {
    expect(reviewVerdictOf("## Factory review: pass")).toBeUndefined();
  });

  it("reads back the merge danger the summary writes", () => {
    expect(mergeDangerOf(changes)).toEqual({
      door: "one-way",
      blastRadius: "wide",
      reason: "touches the protocol",
    });
  });

  it("picks the newest comment carrying the marker", () => {
    const older = { body: pass, createdAt: "2026-11-08T10:00:00Z" };
    const newer = { body: changes, createdAt: "2026-11-08T11:00:00Z" };
    const other = { body: "LGTM", createdAt: "2026-11-08T12:00:00Z" };

    expect(newestMarkerComment([older, other, newer])).toBe(newer);
    expect(newestMarkerComment([other])).toBeUndefined();
  });
});
