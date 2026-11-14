/**
 * The review gate: may this run review now? Prints `true` or `false` for the
 * workflow, and the reason on stderr. The queue is the `agent:review` label:
 * inside the Budapest night window the answer is always yes; in the day it is
 * yes while fewer than `FACTORY_DAY_REVIEWS` reviews have run today. A manual
 * dispatch of a pull request whose newest factory comment is "could not
 * review" is a recovery — the failed run lost the review, so the dispatch
 * runs it at once, without a relabel and without queueing it for the night.
 *
 * Env: GH_REPO, PR_NUMBER, LABELS, MANUAL, FACTORY_DAY_REVIEWS (optional,
 * default 2).
 */
import { lastFactoryCommentIsFailure, queueDecision } from "#review/retry.ts";
import {
  DEFAULT_DAY_REVIEWS,
  daytimeReviewsToday,
  reviewDecision,
  type IssueComment,
} from "#review/window.ts";
import { fail, required, sh } from "#shared/common.ts";
import { issueComments } from "#shared/github.ts";

const parseQuota = (raw: string): number => {
  if (raw.trim() === "") return DEFAULT_DAY_REVIEWS;
  const quota = Number(raw);
  if (!Number.isInteger(quota) || quota < 0) {
    return fail(`FACTORY_DAY_REVIEWS must be a non-negative integer, got '${raw}'.`);
  }
  return quota;
};

const isComment = (value: unknown): value is IssueComment =>
  typeof value === "object" &&
  value !== null &&
  "body" in value &&
  typeof value.body === "string" &&
  "createdAt" in value &&
  typeof value.createdAt === "string";

const parseComment = (line: string): IssueComment => {
  const parsed: unknown = JSON.parse(line);
  return isComment(parsed) ? parsed : fail(`gh returned a comment that is not JSON: ${line}`);
};

/** Every comment in the repository, for the daytime quota; a day either way is enough. */
const repoComments = (repo: string): IssueComment[] => {
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  return sh(
    `gh api "repos/${repo}/issues/comments?since=${since}&per_page=100" --paginate --jq '.[] | {body: .body, createdAt: .created_at}'`,
  )
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseComment);
};

try {
  const repo = required("GH_REPO");
  const pr = required("PR_NUMBER");
  const labels = (process.env["LABELS"] ?? "").split(" ").filter((label) => label !== "");
  const manual = process.env["MANUAL"] === "true";
  const labelled = labels.includes("agent:review");
  const queue = queueDecision({
    labelled,
    manual,
    // Only a manual dispatch that lacks the queue label needs the read.
    failedReview: manual && !labelled && lastFactoryCommentIsFailure(issueComments(repo, pr)),
  });
  if (!queue.review) {
    console.error(`review gate: ${queue.reason}`);
    console.log("false");
  } else if (queue.reason === "recovery") {
    console.error("review gate: recovery");
    console.log("true");
  } else {
    const now = new Date();
    const decision = reviewDecision({
      at: now,
      reviewsToday: daytimeReviewsToday(repoComments(repo), now),
      dayQuota: parseQuota(process.env["FACTORY_DAY_REVIEWS"] ?? ""),
    });
    console.error(`review gate: ${decision.reason}`);
    console.log(decision.review ? "true" : "false");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
