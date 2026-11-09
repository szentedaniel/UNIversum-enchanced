/**
 * The comments and issue bodies the intake steps write. Pure: the scripts post
 * exactly what these return, and the dry run prints the same text.
 */
import { NEEDS_INFO, NEEDS_TRIAGE, READY_FOR_AGENT, SPEC_PROPOSED } from "#intake/select.ts";
import type { Triage } from "#intake/schema.ts";

/**
 * The spec draft's delimiters. The draft is posted as a comment, the owner's
 * `spec:approved` sends it to the split step, and the markers are how split
 * finds the text the owner actually approved — never a heading guess.
 */
export const SPEC_MARKER = "<!-- factory-spec -->";
export const SPEC_END = "<!-- /factory-spec -->";

/** The needs-info comment: the questions, numbered so a reply can follow them. */
export const questionsComment = (questions: readonly string[]): string =>
  [
    "## Factory triage: needs info",
    "",
    "The issue needs these answers before an agent can implement it:",
    "",
    ...questions.map((question, index) => `${String(index + 1)}. ${question}`),
    "",
  ].join("\n");

/** The spec draft comment: the spec between the markers, the approval note outside. */
export const specComment = (spec: string): string =>
  [
    SPEC_MARKER,
    spec.trim(),
    SPEC_END,
    "",
    "The owner applies `spec:approved` to split this spec into tickets on the next intake run.",
    "",
  ].join("\n");

/**
 * The spec text split turns into tickets: the newest comment carrying the
 * markers (the owner may have edited the draft), else the issue body (a spec
 * the owner wrote themselves), else nothing.
 */
export const approvedSpecOf = ({
  body,
  comments,
}: {
  readonly body: string;
  readonly comments: readonly string[];
}): string | null => {
  for (const comment of comments.toReversed()) {
    const start = comment.indexOf(SPEC_MARKER);
    if (start === -1) continue;
    const rest = comment.slice(start + SPEC_MARKER.length);
    const end = rest.indexOf(SPEC_END);
    const spec = (end === -1 ? rest : rest.slice(0, end)).trim();
    if (spec !== "") return spec;
  }
  const fallback = body.trim();
  return fallback === "" ? null : fallback;
};

/** A child ticket's body: the `Parent: #<n>` line first, as every ticket has it. */
export const childBody = (parent: number, body: string): string =>
  `Parent: #${String(parent)}\n\n${body.trim()}\n`;

/** The parent issue's new body: the approved spec, nothing else. */
export const specBody = (spec: string): string => `${spec.trim()}\n`;

/** What one triage decision changes on the issue. */
export interface TriageAction {
  /** The comment to post. */
  comment: string;
  /** Labels to add. */
  add: readonly string[];
  /** Labels to remove; only ones the issue actually carries. */
  remove: readonly string[];
}

/**
 * The decision as writes: ready hands the issue to the dispatcher with the
 * Implementation context comment; needs-info asks the questions; spec posts the
 * draft for the owner. Every outcome retires `needs-triage`, so the issue is
 * classified once, not nightly.
 */
export const triageAction = (decision: Triage, currentLabels: readonly string[]): TriageAction => {
  const remove = currentLabels.includes(NEEDS_TRIAGE) ? [NEEDS_TRIAGE] : [];
  if (decision.kind === "ready") {
    return { comment: decision.context.trim(), add: [READY_FOR_AGENT], remove };
  }
  if (decision.kind === "needs-info") {
    return { comment: questionsComment(decision.questions), add: [NEEDS_INFO], remove };
  }
  return { comment: specComment(decision.spec), add: [SPEC_PROPOSED], remove };
};
