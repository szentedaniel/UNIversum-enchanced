/**
 * The dispatch frontier: the open `ready-for-agent` issues a run may start on
 * right now, oldest first. Pure — the dispatcher fetches the facts (labels,
 * blockers, sub-issues, open pull requests, running runs) and this decides.
 */
import { closingPull, type PullFacts } from "#shared/closing-pr.ts";
import { isTicketWork, READY_LABEL } from "#shared/labels.ts";
import { branchNamesTarget, shareModule, targetPathsIn } from "#shared/targets.ts";

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
  /** The issue body: its `## Files` list names the modules the ticket targets. */
  body: string | null;
}

/** An open pull request and the work it holds: its files and its branch. */
export interface OpenPull extends PullFacts {
  number: number;
  branch: string;
  files: readonly string[];
}

export interface SkippedIssue {
  issue: IssueFacts;
  /** Why the dispatcher passes it over, as the dry run prints it. */
  reason: string;
  /** The open pull request the ticket overlaps, when that is the reason. */
  blockingPull?: OpenPull;
}

export interface Frontier {
  /** Dispatchable, in dispatch order. */
  eligible: IssueFacts[];
  /** Not dispatchable, oldest first, with the reason. */
  skipped: SkippedIssue[];
}

/**
 * The note a ticket blocked by an open pull request gets, once per pull: the
 * hidden marker is the dedupe, and the body names the pull request number so
 * the owner can see what the ticket waits for.
 */
export const overlapNote = (pull: OpenPull): { marker: string; body: string } => {
  const marker = `<!-- factory-overlap:#${String(pull.number)} -->`;
  return {
    marker,
    body: [
      marker,
      `Holding this ticket: open pull request #${String(pull.number)} (${pull.url}) changes the same target module.`,
      "",
      "It keeps `ready-for-agent`, and the dispatcher starts it once the pull request merges or closes.",
    ].join("\n"),
  };
};

export const IN_PROGRESS_LABEL = "agent:in-progress";
export const BLOCKED_LABEL = "agent:blocked";
export const HUMAN_LABEL = "ready-for-human";

/**
 * The labels of the work that holds a module against a newer ticket: an agent
 * owns it now or next. A stalled ticket (`agent:blocked`, `ready-for-human`)
 * holds nothing — the newer ticket would wait on it indefinitely, and only a
 * pull-request overlap posts a note.
 */
const HOLDING_LABELS: ReadonlySet<string> = new Set([READY_LABEL, IN_PROGRESS_LABEL]);

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
 * The open pull request a ticket overlaps: one that changes a file the ticket
 * names, or whose branch slug carries the module's path.
 */
const overlappingPull = (
  paths: readonly string[],
  pulls: readonly OpenPull[],
): OpenPull | undefined => {
  if (paths.length === 0) return undefined;
  return pulls.find(
    (pull) =>
      shareModule(paths, pull.files) || paths.some((path) => branchNamesTarget(pull.branch, path)),
  );
};

/**
 * Splits the candidates into what to dispatch and what to skip, both oldest
 * first. `busy` holds the issues a queued or running implement run already
 * covers; `openWork` holds every open issue, so an older ticket or a running
 * one claims its module and a newer duplicate waits for it. A spec and a
 * stalled ticket claim nothing: neither will start on the module by itself.
 */
export const frontierOf = (
  issues: readonly IssueFacts[],
  pulls: readonly OpenPull[],
  busy: ReadonlySet<number> = new Set(),
  openWork: readonly IssueFacts[] = issues,
): Frontier => {
  const paths = new Map<number, readonly string[]>();
  const targetPathsOf = (issue: IssueFacts): readonly string[] => {
    const cached = paths.get(issue.number);
    if (cached !== undefined) return cached;
    const found = targetPathsIn(issue.body ?? "");
    paths.set(issue.number, found);
    return found;
  };
  const claims = openWork
    .filter(
      (issue) => isTicketWork(issue) && issue.labels.some((label) => HOLDING_LABELS.has(label)),
    )
    .toSorted(byPriorityThenAge);

  const eligible: IssueFacts[] = [];
  const skipped: SkippedIssue[] = [];
  for (const issue of issues) {
    const reason = reasonToSkip(issue, pulls, busy);
    if (reason !== undefined) {
      skipped.push({ issue, reason });
      continue;
    }
    const pull = overlappingPull(targetPathsOf(issue), pulls);
    if (pull !== undefined) {
      skipped.push({
        issue,
        reason: `overlaps open pull request #${String(pull.number)} (${pull.url})`,
        blockingPull: pull,
      });
      continue;
    }
    const holder = claims.find(
      (claim) =>
        claim.number !== issue.number &&
        byPriorityThenAge(claim, issue) < 0 &&
        shareModule(targetPathsOf(claim), targetPathsOf(issue)),
    );
    if (holder !== undefined) {
      skipped.push({ issue, reason: `overlaps #${String(holder.number)} (same target module)` });
      continue;
    }
    eligible.push(issue);
  }
  return {
    eligible: eligible.toSorted(byPriorityThenAge),
    skipped: skipped.toSorted((a, b) => byPriorityThenAge(a.issue, b.issue)),
  };
};
