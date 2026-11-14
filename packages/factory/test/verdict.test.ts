import { describe, expect, it } from "vitest";
import { riskLabel } from "#review/merge-danger.ts";
import { reviewSchema, type Review } from "#review/schema.ts";
import { mergeDangerOf, summaryComment } from "#review/summary.ts";
import {
  reviewWithRetry,
  salvageReview,
  retryTurn,
  type ReviewRun,
  type ReviewRunner,
  type StructuredFailure,
} from "#review/verdict.ts";

/** A thrown attempt that carries the structured-output failure Sandcastle reports. */
class FailingAttempt extends Error {
  readonly failure: StructuredFailure;

  constructor(failure: StructuredFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

const failureOf = (error: unknown): StructuredFailure | undefined =>
  error instanceof FailingAttempt ? error.failure : undefined;

/** The schema issues of a reply that left `mergeDanger` out, plus the raw block it wrote. */
const missingDanger: StructuredFailure = (() => {
  const parsed = reviewSchema.safeParse({
    verdict: "pass",
    findings: ["`packages/factory/src/review/review.ts`: the retry has no cap."],
  });
  if (parsed.success) throw new Error("the fixture must fail the schema");
  return {
    message: "Structured output tag <review> failed schema validation",
    cause: parsed.error.issues,
    rawMatched:
      '{"verdict":"pass","findings":["`packages/factory/src/review/review.ts`: the retry has no cap."]}',
    sessionId: "session-1",
    commits: 1,
  };
})();

/** The corrected reply the second turn writes. */
const corrected: Review = {
  verdict: "pass",
  findings: [],
  mergeDanger: { door: "two-way", blastRadius: "local", reason: "one factory step" },
};

/** A run whose reply always fails the schema the same way. */
const alwaysMissingDanger: ReviewRunner = async () => {
  throw new FailingAttempt(missingDanger);
};

/** A run whose tag is missing even after the retry turn. */
const alwaysMissingTag: ReviewRunner = async () => {
  throw new FailingAttempt({
    message: "Structured output tag <review> not found in agent output",
    cause: undefined,
    rawMatched: undefined,
    sessionId: "session-4",
    commits: 0,
  });
};

/** A run that fails for a reason the retry turn cannot repair. */
const ghFailure: ReviewRunner = async () => {
  throw new Error("gh exploded");
};

describe("retryTurn", () => {
  it("names the missing field and asks for the full block", () => {
    const turn = retryTurn(missingDanger);

    expect(turn?.sessionId).toBe("session-1");
    expect(turn?.prompt).toContain("mergeDanger");
    expect(turn?.prompt).toContain("`<review>` block");
    expect(turn?.prompt).toContain("Do not change files");
  });

  it("cannot retry a failure whose session was not captured", () => {
    expect(retryTurn({ ...missingDanger, sessionId: undefined })).toBeUndefined();
    expect(retryTurn({ ...missingDanger, sessionId: "" })).toBeUndefined();
  });

  it("names a missing tag rather than a missing field", () => {
    const turn = retryTurn({
      message: "Structured output tag <review> not found in agent output",
      cause: undefined,
      rawMatched: undefined,
      sessionId: "session-2",
      commits: 0,
    });

    expect(turn?.prompt).toContain("not found");
    expect(turn?.prompt).toContain("no matching <review> tag");
  });
});

describe("salvageReview", () => {
  it("keeps the verdict and findings when only the merge danger is missing", () => {
    expect(salvageReview(missingDanger.rawMatched)).toEqual({
      verdict: "pass",
      findings: ["`packages/factory/src/review/review.ts`: the retry has no cap."],
    });
  });

  it("unwraps a fenced block", () => {
    expect(
      salvageReview('```json\n{"verdict":"changes-requested","findings":["one"]}\n```'),
    ).toEqual({ verdict: "changes-requested", findings: ["one"] });
  });

  it("drops a block whose verdict or findings are invalid", () => {
    expect(salvageReview('{"verdict":"maybe","findings":[]}')).toBeUndefined();
    expect(salvageReview('{"verdict":"pass","findings":"one"}')).toBeUndefined();
    expect(salvageReview("not json")).toBeUndefined();
    expect(salvageReview(undefined)).toBeUndefined();
  });
});

describe("reviewWithRetry", () => {
  it("gives a reply without mergeDanger a second turn and accepts the corrected block", async () => {
    const turns: (string | undefined)[] = [];
    const run: ReviewRunner = async (resume) => {
      turns.push(resume?.prompt);
      if (turns.length === 1) throw new FailingAttempt(missingDanger);
      return { review: corrected, commits: 0 };
    };

    const outcome = await reviewWithRetry(run, failureOf);

    expect(outcome.retried).toBe(true);
    expect(outcome.salvaged).toBe(false);
    expect(outcome.review).toEqual(corrected);
    expect(outcome.commits).toBe(1);
    expect(turns).toHaveLength(2);
    expect(turns[1]).toContain("mergeDanger");
  });

  it("keeps the verdict and findings when the retry still has no merge danger", async () => {
    const outcome = await reviewWithRetry(alwaysMissingDanger, failureOf);
    const comment = summaryComment(outcome.review);

    expect(outcome.retried).toBe(true);
    expect(outcome.salvaged).toBe(true);
    expect(outcome.review.verdict).toBe("pass");
    expect(outcome.review.findings).toEqual([
      "`packages/factory/src/review/review.ts`: the retry has no cap.",
    ]);
    expect(comment).toContain("## Factory review: pass");
    expect(comment).toContain("the retry has no cap.");
    expect(comment).toContain("Merge danger:** not rated");
    expect(riskLabel(outcome.review.mergeDanger)).toBe("risk:high");
    expect(mergeDangerOf(comment)).toBeUndefined();
  });

  it("salvages the first attempt when the retry's own tag is missing", async () => {
    let attempt = 0;
    const run: ReviewRunner = async () => {
      attempt += 1;
      throw new FailingAttempt(
        attempt === 1
          ? missingDanger
          : {
              message: "Structured output tag <review> not found in agent output",
              cause: undefined,
              rawMatched: undefined,
              sessionId: "session-1",
              commits: 1,
            },
      );
    };

    const outcome = await reviewWithRetry(run, failureOf);

    expect(outcome.salvaged).toBe(true);
    expect(outcome.review.verdict).toBe("pass");
    expect(outcome.commits).toBe(2);
  });

  it("gives a missing tag one retry turn before failing", async () => {
    let attempt = 0;
    const run: ReviewRunner = async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new FailingAttempt({
          message: "Structured output tag <review> not found in agent output",
          cause: undefined,
          rawMatched: undefined,
          sessionId: "session-3",
          commits: 0,
        });
      }
      return { review: corrected, commits: 0 } satisfies ReviewRun;
    };

    expect((await reviewWithRetry(run, failureOf)).review).toEqual(corrected);
    expect(attempt).toBe(2);
  });

  it("fails after the retry when neither attempt carries a usable block", async () => {
    await expect(reviewWithRetry(alwaysMissingTag, failureOf)).rejects.toThrow("not found");
  });

  it("does not retry an error that is not a structured-output failure", async () => {
    await expect(reviewWithRetry(ghFailure, failureOf)).rejects.toThrow("gh exploded");
  });
});
