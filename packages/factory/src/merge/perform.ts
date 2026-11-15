/**
 * The merge gate's actions: what a decided `MergeStep` does to GitHub. The
 * `MergeActions` adapter is the seam: `merge.ts` wraps `gh`, the tests record
 * the calls, so the flow that went wrong before (the escalation, the fix
 * dispatch, the merge read-back) is reachable without a repository.
 */
import type { FixReason } from "#fix/reasons.ts";
import {
  escalationComment,
  followUpIssue,
  newestEscalation,
  type FollowUpIssue,
} from "#merge/comment.ts";
import type { PullView } from "#merge/facts.ts";
import { mergeSubjectOf, type MergeStep } from "#merge/gates.ts";
import type { ReviewComment } from "#review/summary.ts";
import { closingIssue } from "#shared/closing-pr.ts";
import { isMergeInProgress } from "#shared/github.ts";

/** What a re-read of the pull request says after a merge GitHub refused as already running. */
export type MergeProgress = "merged" | "merge-queued" | "open";

/** Every write the gate does, plus the reads the writes need. */
export interface MergeActions {
  label(name: string): void;
  /** Posts a comment on the pull request. */
  comment(body: string): void;
  dispatchFix(reason: FixReason): void;
  /** Merges and returns the merge commit's oid (`""` or `"null"` when none). */
  merge(subject: string): string;
  /** Comments on the ticket the pull request closes. */
  commentOnIssue(issue: number, body: string): void;
  /** Closes the ticket, tolerating the merge having closed it already. */
  closeIssue(issue: number): void;
  /** Files the advisory findings as one `needs-triage` issue after the merge. */
  fileFollowUp(issue: FollowUpIssue): void;
  /** The ticket's title: the merge subject names the ticket, not the pull request. */
  ticketTitle(issue: number): string;
  /** The pull request's comments now: what the gate posted in an earlier run, read again. */
  comments(): readonly ReviewComment[];
  /** The pull request now, re-read after GitHub refused the merge as already running. */
  mergeProgress(): MergeProgress;
}

export interface PerformContext {
  readonly actions: MergeActions;
  readonly dryRun: boolean;
}

/**
 * The merge: its subject names the ticket the pull request closes (or, for a
 * dependency bump, the pull request itself), and the read-back proves GitHub
 * made the merge commit a fork or a branch protection rule can swallow.
 */
const mergePull = (pull: PullView, advisory: readonly string[], ctx: PerformContext): void => {
  const issue = pull.closing[0] ?? closingIssue(pull.body);
  const ticket =
    issue === undefined
      ? undefined
      : {
          number: issue,
          title: ctx.actions.ticketTitle(issue).trim() || pull.title,
        };
  const subject = mergeSubjectOf({
    number: pull.number,
    title: pull.title,
    ticket,
    headRefName: pull.headRefName,
    author: pull.author,
  });
  if (subject === undefined) {
    throw new Error(`Pull request #${pull.number} closes no issue; cannot name the merge commit.`);
  }
  console.log(`Merging #${pull.number} as "${subject}".`);
  if (ctx.dryRun) return;

  let commit: string;
  try {
    commit = ctx.actions.merge(subject);
  } catch (error) {
    if (!isMergeInProgress(error)) throw error;
    // Two runs can decide one pull request at the same moment and both reach
    // the merge; GitHub then refuses the second as already in progress. The
    // merge is the first run's to finish and to book-keep, so all this run
    // does is read whether it landed or is still queued, and leave it.
    const progress = ctx.actions.mergeProgress();
    if (progress === "open") throw error;
    console.log(`Another run's merge has #${pull.number} (${progress}); leaving it to that run.`);
    return;
  }
  if (commit === "" || commit === "null") {
    throw new Error(`Pull request #${pull.number} merged but reported no merge commit.`);
  }
  if (issue !== undefined) {
    ctx.actions.commentOnIssue(issue, `Merged in ${commit}.`);
    ctx.actions.closeIssue(issue);
  }
  // The advisory findings outlive the merge as one issue for the nightly
  // intake. Filing it after the merge keeps a refused merge issue-free.
  // The merge already landed: a refused issue is logged, never a red run that
  // a re-run could not repair.
  if (advisory.length > 0) {
    try {
      ctx.actions.fileFollowUp(followUpIssue(pull, advisory));
    } catch (error) {
      console.log(
        `::warning::The advisory follow-up issue was not filed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  console.log(`Merged in ${commit}. The push to main starts the dispatcher itself.`);
};

/** What the merge workflow should do with this pull request now. */
export const performStep = (step: MergeStep, pull: PullView, ctx: PerformContext): void => {
  // Exhaustive: a new MergeStep kind must not fall through to a merge.
  switch (step.kind) {
    case "wait":
      console.log(`Waiting: ${step.reason}`);
      return;
    case "requeue-review":
      console.log("The head moved after the review: queueing it for a new one.");
      if (!ctx.dryRun) ctx.actions.label("agent:review");
      return;
    case "fix":
      console.log(`Dispatching the fix loop: ${step.reason}.`);
      if (!ctx.dryRun) ctx.actions.dispatchFix(step.reason);
      return;
    case "escalate": {
      console.log(`Handing to a human:\n${step.reasons.map((reason) => `- ${reason}`).join("\n")}`);
      if (ctx.dryRun) return;
      const body = escalationComment(step.reasons);
      // A second run that decided the same pull request at the same moment
      // reads the older comments too; the newest of the gate's own says
      // whether the waiting comment is already there.
      if (newestEscalation(ctx.actions.comments())?.body.trim() === body.trim()) {
        console.log("The newest waiting comment already says this; not posting it again.");
      } else {
        ctx.actions.comment(body);
      }
      // The label is what holds the pull request; adding it twice is a no-op,
      // and it must survive the comment already being there.
      ctx.actions.label("ready-for-human");
      return;
    }
    case "merge":
      mergePull(pull, step.advisory, ctx);
      return;
    default: {
      const unhandled: never = step;
      throw new Error(`unhandled merge step ${JSON.stringify(unhandled)}`);
    }
  }
};
