/**
 * The merge gate's actions: what a decided `MergeStep` does to GitHub. The
 * `MergeActions` adapter is the seam: `merge.ts` wraps `gh`, the tests record
 * the calls, so the flow that went wrong before (the escalation, the fix
 * dispatch, the merge read-back) is reachable without a repository.
 */
import type { FixReason } from "#fix/reasons.ts";
import { escalationComment } from "#merge/comment.ts";
import type { PullView } from "#merge/facts.ts";
import { mergeSubjectOf, type MergeStep } from "#merge/gates.ts";
import { closingIssue } from "#shared/closing-pr.ts";

/** Every write the gate does, plus the one read the merge subject needs. */
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
  /** The ticket's title: the merge subject names the ticket, not the pull request. */
  ticketTitle(issue: number): string;
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
const mergePull = (pull: PullView, ctx: PerformContext): void => {
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

  const commit = ctx.actions.merge(subject);
  if (commit === "" || commit === "null") {
    throw new Error(`Pull request #${pull.number} merged but reported no merge commit.`);
  }
  if (issue !== undefined) {
    ctx.actions.commentOnIssue(issue, `Merged in ${commit}.`);
    ctx.actions.closeIssue(issue);
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
    case "escalate":
      console.log(`Handing to a human:\n${step.reasons.map((reason) => `- ${reason}`).join("\n")}`);
      if (ctx.dryRun) return;
      ctx.actions.comment(escalationComment(step.reasons));
      ctx.actions.label("ready-for-human");
      return;
    case "merge":
      mergePull(pull, ctx);
      return;
    default: {
      const unhandled: never = step;
      throw new Error(`unhandled merge step ${JSON.stringify(unhandled)}`);
    }
  }
};
