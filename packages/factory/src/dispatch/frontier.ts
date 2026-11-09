/**
 * The dispatch frontier: the open `ready-for-agent` issues a run may start on
 * right now, oldest first. Pure — the dispatcher fetches the facts (labels,
 * blockers, sub-issues, open pull requests, running runs) and this decides.
 */
import { closingPull, type PullFacts } from "#shared/closing-pr.ts";

/** The fields of a REST issue the frontier reads. */
export interface IssueFacts {
 number: number;
 title: string;
 /** ISO `created_at`; with no priority label yet, age is the order. */
 createdAt: string;
 labels: readonly string[];
 /** `issue_dependencies_summary.blocked_by`: the cheap pre-filter for the fetch. */
 blockedBy: number;
 /** The blockers the dependencies call returned with `state: "open"`. */
 openBlockers: readonly number[];
 /** `sub_issues_summary.total`: a spec is not a ticket. */
 subIssues: number;
}

export interface SkippedIssue {
 issue: IssueFacts;
 /** Why the dispatcher passes it over, as the dry run prints it. */
 reason: string;
}

export interface Frontier {
 /** Dispatchable, in dispatch order. */
 eligible: IssueFacts[];
 /** Not dispatchable, oldest first, with the reason. */
 skipped: SkippedIssue[];
}

export const IN_PROGRESS_LABEL = "agent:in-progress";
export const BLOCKED_LABEL = "agent:blocked";
export const HUMAN_LABEL = "ready-for-human";

/**
 * The priority seam: a label here sorts above age, in list order. Red main
 * carries `priority:top`, so the bug the maintenance watch opens is the next
 * implementer an empty frontier would start on.
 */
export const PRIORITY_LABELS: readonly string[] = ["priority:top"];

export const priorityOf = (labels: readonly string[]): number => {
 const index = PRIORITY_LABELS.findIndex((label) => labels.includes(label));
 return index === -1 ? PRIORITY_LABELS.length : index;
};

const byPriorityThenAge = (a: IssueFacts, b: IssueFacts): number =>
 priorityOf(a.labels) - priorityOf(b.labels) ||
 Date.parse(a.createdAt) - Date.parse(b.createdAt) ||
 a.number - b.number;

const reasonToSkip = (
 issue: IssueFacts,
 pulls: readonly PullFacts[],
 busy: ReadonlySet<number>,
): string | undefined => {
 if (issue.labels.includes(IN_PROGRESS_LABEL)) return `a run holds it (${IN_PROGRESS_LABEL})`;
 if (issue.labels.includes(BLOCKED_LABEL)) return `waiting for a human (${BLOCKED_LABEL})`;
 if (issue.labels.includes(HUMAN_LABEL)) return `the owner implements it (${HUMAN_LABEL})`;
 // The run sets `agent:in-progress` only once it starts; a queued run is
 // still a dispatch, and picking the issue again would queue a second one.
 if (busy.has(issue.number)) return "already dispatched (a run is queued or running)";
 if (issue.openBlockers.length > 0) {
  return `blocked by ${issue.openBlockers.map((number) => `#${String(number)}`).join(", ")}`;
 }
 if (issue.subIssues > 0) {
  const plural = issue.subIssues === 1 ? "" : "s";
  return `a spec, not a ticket (${String(issue.subIssues)} sub-issue${plural})`;
 }
 const pull = closingPull(pulls, issue.number);
 if (pull) return `open pull request ${pull.url}`;
 return undefined;
};

/**
 * Splits the candidates into what to dispatch and what to skip, both oldest
 * first. `busy` holds the issues a queued or running implement run already
 * covers.
 */
export const frontierOf = (
 issues: readonly IssueFacts[],
 pulls: readonly PullFacts[],
 busy: ReadonlySet<number> = new Set(),
): Frontier => {
 const eligible: IssueFacts[] = [];
 const skipped: SkippedIssue[] = [];
 for (const issue of issues) {
  const reason = reasonToSkip(issue, pulls, busy);
  if (reason === undefined) eligible.push(issue);
  else skipped.push({ issue, reason });
 }
 return {
  eligible: eligible.toSorted(byPriorityThenAge),
  skipped: skipped.toSorted((a, b) => byPriorityThenAge(a.issue, b.issue)),
 };
};
