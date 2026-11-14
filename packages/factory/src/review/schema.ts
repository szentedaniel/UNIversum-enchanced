import { z } from "zod";

/**
 * The reviewer's structured output, the one contract between the prompt and
 * the workflow: the verdict picks the label, the findings go into the pull
 * request's summary comment, and the merge danger decides `risk:low` vs
 * `risk:high`.
 *
 * The wording of `door` and `blastRadius` is the `/pr` skill's (and the
 * factory spec's merge gate): a one-way door cannot be reverted cheaply, and
 * a wide blast radius reaches beyond the one place the diff changed.
 */
export const reviewSchema = z.object({
  verdict: z.enum(["pass", "changes-requested"]),
  // What the reviewer could not fix. The fixes themselves are the commits.
  findings: z.array(z.string().min(1)),
  mergeDanger: z.object({
    door: z.enum(["one-way", "two-way"]),
    blastRadius: z.enum(["local", "wide"]),
    reason: z.string().min(1),
  }),
});

/** The strict reply the reviewer emits; a failed validation may still salvage its core. */
export type ReviewReply = z.infer<typeof reviewSchema>;
export type ReviewVerdict = ReviewReply["verdict"];
export type MergeDanger = ReviewReply["mergeDanger"];

/**
 * What the review step posts: the strict reply, or the verdict and findings
 * alone when the retry carried no merge danger. A missing rating is not a
 * reason to throw the review away; the merge gate reads it as high risk.
 */
export interface Review {
  readonly verdict: ReviewVerdict;
  readonly findings: readonly string[];
  readonly mergeDanger?: MergeDanger;
}
