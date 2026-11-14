import { describe, expect, it } from "vitest";
import {
  advisoryOnly,
  findingsOf,
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

  it("lists the findings the reviewer could not fix, with their severities", () => {
    const comment = summaryComment({
      verdict: "changes-requested",
      findings: [
        { text: "`apps/web/src/foo.ts`: the retry has no cap.", severity: "blocking" },
        { text: "No test pins the empty list.", severity: "advisory" },
      ],
      mergeDanger: { door: "one-way", blastRadius: "wide", reason: "state migration" },
    });

    expect(comment).toContain("## Factory review: changes requested");
    expect(comment).toContain("- **Blocking:** `apps/web/src/foo.ts`: the retry has no cap.");
    expect(comment).toContain("- **Advisory:** No test pins the empty list.");
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
    findings: [{ text: "No test pins the empty list.", severity: "blocking" }],
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

describe("findingsOf", () => {
  it("reads back the severities the summary writes", () => {
    const comment = summaryComment({
      verdict: "changes-requested",
      findings: [
        { text: "The retry has no cap.", severity: "blocking" },
        { text: "The helper could be shared.", severity: "advisory" },
        { text: "A second advisory.", severity: "advisory" },
      ],
      mergeDanger: { door: "two-way", blastRadius: "local", reason: "one factory step" },
    });

    expect(findingsOf(comment)).toEqual({
      blocking: ["The retry has no cap."],
      advisory: ["The helper could be shared.", "A second advisory."],
    });
  });

  it("counts a finding with no severity as blocking, the older comment's fallback", () => {
    const comment = [
      REVIEW_MARKER,
      "## Factory review: changes requested",
      "",
      "The reviewer committed the fixes it was sure of. These are the findings it left:",
      "",
      "- No test pins the empty list.",
      "",
      "**Merge danger:** two-way door, local blast radius. one step",
      "",
    ].join("\n");

    expect(findingsOf(comment)).toEqual({
      blocking: ["No test pins the empty list."],
      advisory: [],
    });
  });

  it("reads no findings from the placeholder or a comment with no list", () => {
    const none = summaryComment({
      verdict: "pass",
      findings: [],
      mergeDanger: { door: "two-way", blastRadius: "local", reason: "one factory step" },
    });

    expect(findingsOf(none)).toEqual({ blocking: [], advisory: [] });
    expect(findingsOf("## Factory review: pass")).toEqual({ blocking: [], advisory: [] });
  });
});

describe("advisoryOnly", () => {
  const review = (findings: Parameters<typeof summaryComment>[0]["findings"]) =>
    summaryComment({
      verdict: "changes-requested",
      findings,
      mergeDanger: { door: "two-way", blastRadius: "local", reason: "one factory step" },
    });

  it("holds when every finding is advisory", () => {
    expect(advisoryOnly(review([{ text: "The helper could be shared.", severity: "advisory" }]))).toBe(
      true,
    );
  });

  it("fails on one blocking finding among the advisory ones", () => {
    expect(
      advisoryOnly(
        review([
          { text: "The helper could be shared.", severity: "advisory" },
          { text: "The retry has no cap.", severity: "blocking" },
        ]),
      ),
    ).toBe(false);
  });

  it("fails on a changes-requested review that lists no findings at all", () => {
    expect(advisoryOnly(review([]))).toBe(false);
  });

  it("fails on a passing review, which the gate already merges", () => {
    const pass = summaryComment({
      verdict: "pass",
      findings: [{ text: "The helper could be shared.", severity: "advisory" }],
      mergeDanger: { door: "two-way", blastRadius: "local", reason: "one factory step" },
    });

    expect(advisoryOnly(pass)).toBe(false);
  });
});
