/**
 * The review gate: may this run review now? Prints `true` or `false` for the
 * workflow, and the reason on stderr. It is safe to call at any time of day:
 * inside the Budapest night window the answer is always yes; in the day it is
 * yes while fewer than `FACTORY_DAY_REVIEWS` reviews have run today.
 *
 * Env: GH_REPO, FACTORY_DAY_REVIEWS (optional, default 2).
 */
import {
  DEFAULT_DAY_REVIEWS,
  daytimeReviewsToday,
  reviewDecision,
  type IssueComment,
} from "#review/window.ts";
import { fail, required, sh } from "#shared/common.ts";

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

try {
  const repo = required("GH_REPO");
  const dayQuota = parseQuota(process.env["FACTORY_DAY_REVIEWS"] ?? "");

  // A day plus the time zone's offset either way: the exact Budapest day is
  // filtered below, this only keeps the API response small.
  const since = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const comments = sh(
    `gh api "repos/${repo}/issues/comments?since=${since}&per_page=100" --paginate --jq '.[] | {body: .body, createdAt: .created_at}'`,
  )
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map(parseComment);

  const now = new Date();
  const decision = reviewDecision({
    at: now,
    reviewsToday: daytimeReviewsToday(comments, now),
    dayQuota,
  });
  console.error(`review gate: ${decision.reason}`);
  console.log(decision.review ? "true" : "false");
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
