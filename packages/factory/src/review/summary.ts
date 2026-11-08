import type { Review } from "#review/schema.ts";
import { REVIEW_MARKER } from "#review/window.ts";

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
  `## Factory review: ${review.verdict === "pass" ? "pass" : "changes requested"}`,
  "",
  "The reviewer committed the fixes it was sure of. These are the findings it could not fix:",
  "",
  ...findings,
  "",
  `**Merge danger:** ${door} door, ${blastRadius} blast radius. ${reason}`,
  "",
 ].join("\n");
};
