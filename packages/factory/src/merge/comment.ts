/**
 * The merge gate's escalation comment: the one comment it posts when it will
 * not auto-merge a pull request. Its marker is the retro's sign that a pull
 * request went to the owner.
 */

/** The hidden marker the escalation comment opens with. */
export const MERGE_ESCALATED_MARKER = "<!-- factory-merge -->";

export const escalationComment = (reasons: readonly string[]): string =>
  [
    MERGE_ESCALATED_MARKER,
    "## Factory merge: waiting for a human",
    "",
    "The merge gate will not auto-merge this pull request:",
    "",
    ...reasons.map((reason) => `- ${reason}`),
    "",
  ].join("\n");

/** The one follow-up issue an advisory review leaves after its merge. */
export interface FollowUpIssue {
  readonly title: string;
  readonly body: string;
  readonly labels: readonly string[];
}

/**
 * The follow-up issue a merge files for the advisory findings the review
 * left: judgement calls a person may act on after the merge, so the nightly
 * intake decides whether they become a ticket. It names the pull request it
 * came from, and `needs-triage` is what puts it in the intake's queue.
 */
export const followUpIssue = (
  pull: { readonly number: number; readonly title: string },
  findings: readonly string[],
): FollowUpIssue => ({
  title: `Factory review follow-ups: #${String(pull.number)}`,
  body: [
    `The factory merged #${String(pull.number)} (${pull.title}) with advisory review findings. They are judgement calls the reviewer would not block on.`,
    "",
    ...findings.map((finding) => `- ${finding}`),
    "",
    "The nightly intake decides whether they become a ticket or are closed.",
    "",
  ].join("\n"),
  labels: ["needs-triage"],
});
