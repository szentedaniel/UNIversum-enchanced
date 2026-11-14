import { z } from "zod";

/**
 * The reviewer's structured output, the one contract between the prompt and
 * the workflow: the verdict picks the label, the findings go into the pull
 * request's summary comment, and the merge danger decides `risk:low` vs
 * `risk:high`.
 *
 * A finding carries a severity: a blocking one stops the merge, an advisory
 * one is a judgement call the merge gate files as a follow-up. A reply whose
 * findings carry no severity (a prompt from before the severities, a
 * malformed reply) counts every finding as blocking.
 *
 * The wording of `door` and `blastRadius` is the `/pr` skill's (and the
 * factory spec's merge gate): a one-way door cannot be reverted cheaply, and
 * a wide blast radius reaches beyond the one place the diff changed.
 */

/** The two severities a finding carries. */
export const FINDING_SEVERITIES = ["blocking", "advisory"] as const;
export type FindingSeverity = (typeof FINDING_SEVERITIES)[number];

/**
 * One finding: the prompt's object, or the bare string an earlier prompt
 * wrote. The object's severity is optional so that a reply which names the
 * finding but forgets the severity still parses.
 */
const findingSchema = z.union([
  z.object({
    text: z.string().min(1),
    severity: z.enum(FINDING_SEVERITIES).optional(),
  }),
  z.string().min(1),
]);

export const reviewSchema = z.object({
  verdict: z.enum(["pass", "changes-requested"]),
  // What the reviewer could not fix. The fixes themselves are the commits.
  findings: z.array(findingSchema),
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

/** A finding with the severity the verdict reads: an unrated one is blocking. */
export interface ReviewFinding {
  readonly text: string;
  readonly severity: FindingSeverity;
}

/** The reply's findings with a severity each. */
export const ratedFindings = (findings: ReviewReply["findings"]): ReviewFinding[] =>
  findings.map((finding) =>
    typeof finding === "string"
      ? { text: finding, severity: "blocking" }
      : { text: finding.text, severity: finding.severity ?? "blocking" },
  );

/**
 * What the review step posts: the strict reply, or the verdict and findings
 * alone when the retry carried no merge danger. A missing rating is not a
 * reason to throw the review away; the merge gate reads it as high risk.
 */
export interface Review {
  readonly verdict: ReviewVerdict;
  readonly findings: readonly ReviewFinding[];
  readonly mergeDanger?: MergeDanger;
}

/** The accepted reply in the shape the step posts and the readers parse. */
export const reviewOf = (reply: ReviewReply): Review => ({
  verdict: reply.verdict,
  findings: ratedFindings(reply.findings),
  mergeDanger: reply.mergeDanger,
});
