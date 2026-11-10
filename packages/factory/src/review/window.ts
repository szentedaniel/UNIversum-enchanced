/**
 * The review window and the daytime quota, in Budapest local time. The night
 * run is free; daytime reviews are capped so the owner keeps the Pro
 * subscription for their own session.
 */
import { budapestDay, budapestHour } from "#shared/budapest.ts";

/** The night window is [01:00, 07:00) Budapest time. */
export const NIGHT_START_HOUR = 1;
export const NIGHT_END_HOUR = 7;

/** `FACTORY_DAY_REVIEWS`'s default: two daytime reviews a day. */
export const DEFAULT_DAY_REVIEWS = 2;

/**
 * The hidden marker every review summary carries. The daytime quota is
 * counted from these comments, not from run counts: a run that only queues
 * also succeeds, so the workflow's history would overcount.
 */
export const REVIEW_MARKER = "<!-- factory-review -->";

export interface IssueComment {
  readonly body: string;
  readonly createdAt: string;
}

/** True from 01:00 up to (not including) 07:00 on the Budapest clock. */
export const isNightWindow = (at: Date): boolean => {
  const hour = budapestHour(at);
  return hour >= NIGHT_START_HOUR && hour < NIGHT_END_HOUR;
};

/**
 * How many daytime review slots today's summary comments already spent. A
 * night review posts the same comment but does not eat the daytime quota.
 */
export const daytimeReviewsToday = (comments: readonly IssueComment[], at: Date): number => {
  const today = budapestDay(at);
  return comments.filter((comment) => {
    if (!comment.body.includes(REVIEW_MARKER)) return false;
    const createdAt = new Date(comment.createdAt);
    if (Number.isNaN(createdAt.getTime())) return false;
    return budapestDay(createdAt) === today && !isNightWindow(createdAt);
  }).length;
};

export type GateDecision =
  | { readonly review: true; readonly reason: "night-window" | "daytime-quota" }
  | { readonly review: false; readonly reason: "daytime-quota-spent" };

/**
 * Whether this run may review now: always inside the night window, and in
 * the day only while fewer than `dayQuota` daytime reviews already ran. A
 * queued run leaves `agent:review` in place for the night cron.
 */
export const reviewDecision = ({
  at,
  reviewsToday,
  dayQuota = DEFAULT_DAY_REVIEWS,
}: {
  readonly at: Date;
  readonly reviewsToday: number;
  readonly dayQuota?: number;
}): GateDecision => {
  if (isNightWindow(at)) return { review: true, reason: "night-window" };
  if (reviewsToday < dayQuota) return { review: true, reason: "daytime-quota" };
  return { review: false, reason: "daytime-quota-spent" };
};
