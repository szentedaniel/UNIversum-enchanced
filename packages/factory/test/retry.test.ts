import { describe, expect, it } from "vitest";
import {
  failureAction,
  failureComment,
  lastFactoryCommentIsFailure,
  queueDecision,
  REVIEW_FAILED_MARKER,
} from "#review/retry.ts";
import { summaryComment } from "#review/summary.ts";

const reviewComment = (createdAt: string) => ({
  body: summaryComment({
    verdict: "pass",
    findings: [],
    mergeDanger: { door: "two-way", blastRadius: "local", reason: "one factory step" },
  }),
  createdAt,
});

const failedComment = (createdAt: string) => ({
  body: failureComment(
    "Structured output tag <review> not found in agent output",
    "https://x/run/1",
  ),
  createdAt,
});

describe("failureAction", () => {
  it("re-runs a failed review step once", () => {
    expect(failureAction({ reviewFailed: true, retry: false })).toBe("retry");
  });

  it("hands the pull request to a human when the retry itself fails", () => {
    expect(failureAction({ reviewFailed: true, retry: true })).toBe("handoff");
  });

  it("does not re-run a review step that succeeded", () => {
    expect(failureAction({ reviewFailed: false, retry: false })).toBe("handoff");
    expect(failureAction({ reviewFailed: false, retry: true })).toBe("handoff");
  });
});

describe("failureComment", () => {
  it("opens with the marker a manual dispatch reads", () => {
    const comment = failureComment("the reason", "https://x/run/1");

    expect(comment.startsWith(REVIEW_FAILED_MARKER)).toBe(true);
    expect(comment).toContain("The factory could not review this pull request.");
    expect(comment).toContain("**Reason:** the reason");
    expect(comment).toContain("**Run:** https://x/run/1");
    expect(comment).toContain("Re-dispatch `factory-review.yml` to retry.");
  });
});

describe("lastFactoryCommentIsFailure", () => {
  it("is true when the failed review is the newest factory comment", () => {
    expect(
      lastFactoryCommentIsFailure([
        reviewComment("2026-11-14T10:00:00Z"),
        failedComment("2026-11-14T11:00:00Z"),
      ]),
    ).toBe(true);
  });

  it("ignores a person's comment after the failed review", () => {
    expect(
      lastFactoryCommentIsFailure([
        failedComment("2026-11-14T10:00:00Z"),
        { body: "LGTM", createdAt: "2026-11-14T11:00:00Z" },
      ]),
    ).toBe(true);
  });

  it("is false once a review or another factory step has the last word", () => {
    expect(
      lastFactoryCommentIsFailure([
        failedComment("2026-11-14T10:00:00Z"),
        reviewComment("2026-11-14T11:00:00Z"),
      ]),
    ).toBe(false);
    expect(
      lastFactoryCommentIsFailure([
        failedComment("2026-11-14T10:00:00Z"),
        { body: "<!-- factory-merge -->\nwaiting", createdAt: "2026-11-14T11:00:00Z" },
      ]),
    ).toBe(false);
  });

  it("is false when the factory posted nothing", () => {
    expect(lastFactoryCommentIsFailure([])).toBe(false);
    expect(lastFactoryCommentIsFailure([{ body: "LGTM", createdAt: "2026-11-14T10:00:00Z" }])).toBe(
      false,
    );
    expect(
      lastFactoryCommentIsFailure([
        { body: "<!-- factory-fix:round 1 -->\nfix", createdAt: "2026-11-14T10:00:00Z" },
      ]),
    ).toBe(false);
  });
});

describe("queueDecision", () => {
  it("reviews a pull request carrying the queue label", () => {
    expect(queueDecision({ labelled: true, manual: false, failedReview: false })).toEqual({
      review: true,
      reason: "queued",
    });
  });

  it("reviews a manual dispatch of a failed review without a relabel", () => {
    expect(queueDecision({ labelled: false, manual: true, failedReview: true })).toEqual({
      review: true,
      reason: "recovery",
    });
  });

  it("leaves a manual dispatch alone when the last factory word is not a failed review", () => {
    expect(queueDecision({ labelled: false, manual: true, failedReview: false })).toEqual({
      review: false,
      reason: "not-queued",
    });
  });

  it("leaves a label event for another label alone", () => {
    expect(queueDecision({ labelled: false, manual: false, failedReview: true })).toEqual({
      review: false,
      reason: "not-queued",
    });
  });
});
