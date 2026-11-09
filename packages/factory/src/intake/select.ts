/**
 * Which issues the intake steps look at, and when a scheduled run may run.
 * Pure: the scripts fetch the REST facts and this decides. Same shape as the
 * dispatcher's `frontier.ts`: one rule list, oldest first, a hard cap.
 */
import { isNightWindow } from "#review/window.ts";

/** Issues one intake run handles, unless the repo overrides it. */
export const DEFAULT_INTAKE_MAX = 3;

export const NEEDS_TRIAGE = "needs-triage";
export const NEEDS_INFO = "needs-info";
export const READY_FOR_AGENT = "ready-for-agent";
export const SPEC_PROPOSED = "spec:proposed";
export const SPEC_APPROVED = "spec:approved";
export const FACTORY_LABEL = "factory";

/**
 * `author_association` values that mean the owner's side of the repo: only
 * their unlabelled issues are triaged. A label the owner applied themselves
 * (`needs-triage`) is enough whoever filed the issue.
 */
const TEAM_ASSOCIATIONS: ReadonlySet<string> = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);

/** The fields of a REST issue the intake selection reads. */
export interface IntakeIssue {
  number: number;
  title: string;
  /** ISO `created_at`; with no priority, age is the order. */
  createdAt: string;
  /** REST `state`: only open issues are intake work. */
  state: string;
  labels: readonly string[];
  /** REST `author_association`. */
  authorAssociation: string;
  /** REST `pull_request`: a pull request is not an intake issue. */
  isPullRequest: boolean;
  /** REST `parent_issue_url`: non-null when the issue is a spec's sub-issue. */
  parent: number | null;
  /** REST `sub_issues_summary.total`: a spec that already split. */
  subIssues: number;
}

const has = (issue: IntakeIssue, label: string): boolean => issue.labels.includes(label);

const isOpenIssue = (issue: IntakeIssue): boolean => issue.state === "open" && !issue.isPullRequest;

/**
 * A new issue worth triaging: the owner (or a collaborator) filed it without a
 * label, or the owner put it in `needs-triage`. Sub-issues are already tickets.
 */
export const isTriageCandidate = (issue: IntakeIssue): boolean => {
  if (!isOpenIssue(issue) || issue.parent !== null) return false;
  if (has(issue, NEEDS_TRIAGE)) return true;
  return issue.labels.length === 0 && TEAM_ASSOCIATIONS.has(issue.authorAssociation);
};

/**
 * A spec waiting to split. An issue that already has sub-issues split once;
 * re-splitting it would duplicate the tickets, so it is never picked again
 * (even if a failed run left `spec:approved` in place).
 */
export const isSplitCandidate = (issue: IntakeIssue): boolean =>
  isOpenIssue(issue) && issue.parent === null && has(issue, SPEC_APPROVED) && issue.subIssues === 0;

const oldestFirst = (issues: readonly IntakeIssue[], limit: number): IntakeIssue[] =>
  issues
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt) || a.number - b.number)
    .slice(0, limit);

/** The issues one triage run classifies, oldest first. */
export const triageCandidates = (
  issues: readonly IntakeIssue[],
  limit: number,
  only?: number,
): IntakeIssue[] =>
  oldestFirst(
    only === undefined
      ? issues.filter(isTriageCandidate)
      : // A dispatch that names an issue is the owner's override: it is triaged
        // whatever its labels, as long as it is an open issue.
        issues.filter((issue) => issue.number === only && isOpenIssue(issue)),
    limit,
  );

/** The specs one split run turns into tickets, oldest first; `only` narrows, never overrides. */
export const splitCandidates = (
  issues: readonly IntakeIssue[],
  limit: number,
  only?: number,
): IntakeIssue[] =>
  oldestFirst(
    issues.filter(
      (issue) => isSplitCandidate(issue) && (only === undefined || issue.number === only),
    ),
    limit,
  );

/**
 * Whether this run may spend Claude usage. The cron must stay inside the night
 * window; the owner's own dispatch always runs, day or night.
 */
export const intakeAllowed = ({
  eventName,
  at,
}: {
  readonly eventName: string;
  readonly at: Date;
}): boolean => eventName !== "schedule" || isNightWindow(at);
