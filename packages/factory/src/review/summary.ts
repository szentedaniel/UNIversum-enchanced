import type { MergeDanger, Review } from "#review/schema.ts";
import { REVIEW_MARKER } from "#review/window.ts";

export type ReviewVerdict = Review["verdict"];

/** The one heading per verdict, shared by the writer and the reader below. */
const HEADINGS: Readonly<Record<ReviewVerdict, string>> = {
  pass: "## Factory review: pass",
  "changes-requested": "## Factory review: changes requested",
};

/**
 * The one comment a review posts. It opens with the hidden marker the quota
 * counts (see `window.ts`), then the verdict, the findings the reviewer left
 * for a person, and the merge danger in the merge gate's wording.
 */
export const summaryComment = (review: Review): string => {
  const findings =
    review.findings.length === 0
      ? ["- None: the reviewer fixed every finding it reported."]
      : review.findings.map((finding) => `- ${finding}`);
  const { door, blastRadius, reason } = review.mergeDanger;
  return [
    REVIEW_MARKER,
    HEADINGS[review.verdict],
    "",
    "The reviewer committed the fixes it was sure of. These are the findings it left:",
    "",
    ...findings,
    "",
    `**Merge danger:** ${door} door, ${blastRadius} blast radius. ${reason}`,
    "",
  ].join("\n");
};

/** A pull-request comment whose body may be a review summary. */
export interface ReviewComment {
  readonly body: string;
  readonly createdAt: string;
}

/** The verdict a review summary carries; `undefined` for any other comment. */
export const reviewVerdictOf = (comment: string): ReviewVerdict | undefined => {
  if (!comment.includes(REVIEW_MARKER)) return undefined;
  const lines = new Set(comment.split("\n").map((line) => line.trim()));
  if (lines.has(HEADINGS.pass)) return "pass";
  if (lines.has(HEADINGS["changes-requested"])) return "changes-requested";
  return undefined;
};

const DANGER_LINE =
  /^\*\*Merge danger:\*\* (one-way|two-way) door, (local|wide) blast radius\. (.+)$/u;

/** The merge danger a review summary carries; `undefined` when it has none. */
export const mergeDangerOf = (comment: string): MergeDanger | undefined => {
  const line = comment.split("\n").find((candidate) => candidate.startsWith("**Merge danger:**"));
  if (line === undefined) return undefined;
  const match = DANGER_LINE.exec(line.trim());
  const door = match?.[1];
  const blastRadius = match?.[2];
  const reason = match?.[3];
  if (door === undefined || blastRadius === undefined || reason === undefined) return undefined;
  return {
    door: door === "one-way" ? "one-way" : "two-way",
    blastRadius: blastRadius === "wide" ? "wide" : "local",
    reason,
  };
};

/**
 * The newest comment carrying the review marker: the merge gate reads its
 * verdict and merge danger, so the reviewer's latest word is the one that
 * counts.
 */
export const newestMarkerComment = <T extends ReviewComment>(
  comments: readonly T[],
): T | undefined =>
  comments
    .filter((comment) => comment.body.includes(REVIEW_MARKER))
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))
    .at(-1);
