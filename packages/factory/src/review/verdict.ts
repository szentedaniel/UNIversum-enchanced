/**
 * The reviewer's second turn: when the `<review>` block is missing or fails
 * the schema, the same Claude session is asked once more with the error named
 * in the prompt. A reply that still leaves out `mergeDanger` keeps its verdict
 * and findings; the merge gate treats an unrated pull request as high risk.
 */
import { z } from "zod";
import { reviewSchema, type Review } from "#review/schema.ts";

/** What the step reads off Sandcastle's `StructuredOutputError`. */
export interface StructuredFailure {
  readonly message: string;
  readonly cause: unknown;
  readonly rawMatched: string | undefined;
  readonly sessionId: string | undefined;
  /** The fix commits the failed run collected. */
  readonly commits: number;
}

/** A resumed turn: the session to continue and the prompt that repairs the reply. */
export interface RetryTurn {
  readonly sessionId: string;
  readonly prompt: string;
}

/** Zod's issues as `path: message` lines; any other cause as one line. */
const issueSchema = z.array(
  z.object({
    message: z.string(),
    path: z.array(z.unknown()).default([]),
  }),
);

/** A non-issue cause (a JSON parse error, a string) as one line. */
const causeText = (cause: unknown): string => {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  const json = JSON.stringify(cause);
  return json === undefined ? "(no parser detail)" : json;
};

const issuesOf = (cause: unknown): string[] => {
  const issues = issueSchema.safeParse(cause);
  if (!issues.success) return cause === undefined ? [] : [causeText(cause)];
  return issues.data.map(({ message, path }) =>
    path.length === 0 ? message : `${path.map(String).join(".")}: ${message}`,
  );
};

/**
 * The retry prompt for a failure the same session can repair, or `undefined`
 * when Sandcastle captured no session to resume.
 */
export const retryTurn = (failure: StructuredFailure): RetryTurn | undefined => {
  if (failure.sessionId === undefined || failure.sessionId === "") return undefined;
  const issues = issuesOf(failure.cause);
  return {
    sessionId: failure.sessionId,
    prompt: [
      "Your previous reply did not carry a valid `<review>` block.",
      "",
      `Problem: ${failure.message}`,
      ...(issues.length === 0 ? [] : ["", "Details:", ...issues.map((issue) => `- ${issue}`)]),
      "",
      `Previous output: ${failure.rawMatched ?? "(no matching <review> tag was emitted)"}`,
      "",
      "Reply with the full `<review>` block only: valid JSON, no code fence, every field the schema requires, nothing before or after it. Do not change files or run commands.",
    ].join("\n"),
  };
};

/** The part of a reply a failed validation must not discard. */
const coreSchema = reviewSchema.pick({ verdict: true, findings: true });

/** Sandcastle's fence unwrapping: a block may arrive inside a ```json fence. */
const unwrapFences = (text: string): string =>
  /^```(?:json)?\s*\n(?<body>[\s\S]*?)\n\s*```\s*$/u.exec(text)?.groups?.["body"]?.trim() ?? text;

/** The verdict and findings of a raw `<review>` block, without its merge danger. */
export const salvageReview = (raw: string | undefined): Review | undefined => {
  if (raw === undefined) return undefined;
  try {
    const parsed: unknown = JSON.parse(unwrapFences(raw.trim()));
    const core = coreSchema.safeParse(parsed);
    return core.success ? { verdict: core.data.verdict, findings: core.data.findings } : undefined;
  } catch {
    return undefined;
  }
};

/** One reviewer turn: the accepted reply and the fix commits it made. */
export interface ReviewRun {
  readonly review: Review;
  readonly commits: number;
}

/** Runs the reviewer, optionally resuming the failed session for a corrected reply. */
export type ReviewRunner = (resume?: RetryTurn) => Promise<ReviewRun>;

/** Reads a structured-output failure out of a thrown error, or `undefined`. */
export type FailureReader = (error: unknown) => StructuredFailure | undefined;

export interface ReviewOutcome extends ReviewRun {
  /** Whether the reviewer needed its second turn. */
  readonly retried: boolean;
  /** Whether the verdict survived through salvage instead of a valid reply. */
  readonly salvaged: boolean;
}

/**
 * The review step's one retry turn. A missing or invalid block is not the
 * end of the review as long as the verdict and findings are readable, and a
 * failure with no captured session cannot be resumed: the next attempt is the
 * whole run's re-dispatch, not a turn.
 */
export const reviewWithRetry = async (
  run: ReviewRunner,
  failureOf: FailureReader,
): Promise<ReviewOutcome> => {
  try {
    return { ...(await run()), retried: false, salvaged: false };
  } catch (error) {
    const first = failureOf(error);
    const retry = first === undefined ? undefined : retryTurn(first);
    if (first === undefined || retry === undefined) throw error;
    try {
      const second = await run(retry);
      return { ...second, commits: first.commits + second.commits, retried: true, salvaged: false };
    } catch (retryError) {
      const second = failureOf(retryError);
      const salvaged = salvageReview(second?.rawMatched) ?? salvageReview(first.rawMatched);
      if (salvaged === undefined) throw retryError;
      return {
        review: salvaged,
        commits: first.commits + (second?.commits ?? 0),
        retried: true,
        salvaged: true,
      };
    }
  }
};
