/**
 * The review step's next move after a failed run: one automatic re-run of the
 * whole review, then the handoff a person takes over from. The handoff
 * comment's marker is also how a manual dispatch recognises that pull
 * request, so retrying never needs a manual relabel.
 */
import type { ReviewComment } from "#review/summary.ts";

/** The hidden marker the failed-review handoff opens with. */
export const REVIEW_FAILED_MARKER = "<!-- factory-review:failed -->";

/** The prefix every factory comment carries; the newest one is the factory's last word. */
const FACTORY_MARKER = "<!-- factory-";

/** The one comment a failed review leaves when it has no retry left. */
export const failureComment = (reason: string, runUrl: string): string =>
  [
    REVIEW_FAILED_MARKER,
    "The factory could not review this pull request.",
    "",
    `**Reason:** ${reason}`,
    "",
    `**Run:** ${runUrl}`,
    "",
    "Re-dispatch `factory-review.yml` to retry.",
  ].join("\n");

/**
 * Whether the pull request's newest factory comment is the failed-review
 * handoff. A later review, fix round or merge-gate refusal means the pull
 * request is held for another reason, and a manual dispatch leaves it alone.
 */
export const lastFactoryCommentIsFailure = (comments: readonly ReviewComment[]): boolean => {
  const newest = comments
    .filter((comment) => comment.body.includes(FACTORY_MARKER))
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1);
  return newest !== undefined && newest.body.includes(REVIEW_FAILED_MARKER);
};

export type FailureAction = "retry" | "handoff";

/**
 * One automatic re-run for a failed review step — the missing or invalid
 * `<review>` block that the session's own retry could not repair — and never
 * a second one, nor a re-run for a step after the review (a failed push).
 */
export const failureAction = (state: {
  readonly reviewFailed: boolean;
  readonly retry: boolean;
}): FailureAction => (state.reviewFailed && !state.retry ? "retry" : "handoff");

export interface QueueFacts {
  /** The pull request carries `agent:review`. */
  readonly labelled: boolean;
  /** This run was dispatched by hand with a pull request number. */
  readonly manual: boolean;
  /** The pull request's newest factory comment is the failed-review handoff. */
  readonly failedReview: boolean;
}

export type QueueDecision =
  | { readonly review: true; readonly reason: "queued" | "recovery" }
  | { readonly review: false; readonly reason: "not-queued" };

/**
 * Whether this pull request may be reviewed at all: the queue label, or a
 * manual dispatch of a pull request whose last factory word is "could not
 * review". That dispatch is the owner re-asking for the review the failed run
 * lost, so it runs without a relabel; a pull request held for another reason
 * (a spent fix budget, a merge-gate refusal) stays untouched.
 */
export const queueDecision = (facts: QueueFacts): QueueDecision => {
  if (facts.labelled) return { review: true, reason: "queued" };
  if (facts.manual && facts.failedReview) return { review: true, reason: "recovery" };
  return { review: false, reason: "not-queued" };
};
