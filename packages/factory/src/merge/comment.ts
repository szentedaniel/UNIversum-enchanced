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
