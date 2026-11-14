/**
 * The review step's failure path, on the same runner: one automatic re-run
 * when the review step itself failed, then the handoff to a person. The
 * workflow owns the checkout and the run's failure; this script owns the
 * decision, the comment and the labels.
 *
 * Env: PR_NUMBER, RUN_URL, REVIEW_FAILED, RETRY, OUTPUT_DIR.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { failureAction, failureComment } from "#review/retry.ts";
import { outputDir, required, safeSh, sh, shellArg } from "#shared/common.ts";

const NO_REASON = "(no reason file written; check the run log)";

/** The review script's failure reason, or a note that it left none. */
const failureReason = (dir: string): string => {
  try {
    const reason = readFileSync(join(dir, "failure_reason.txt"), "utf8").trim();
    return reason === "" ? NO_REASON : reason;
  } catch {
    return NO_REASON;
  }
};

/** Dispatch the whole review once more; a failed dispatch falls back to the handoff. */
const redispatch = (pr: string): boolean => {
  try {
    sh(`gh workflow run factory-review.yml -f pr=${pr} -f retry=true`);
    return true;
  } catch (error) {
    console.error(
      `The retry dispatch failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return false;
  }
};

/** The comment and labels that leave the pull request to the owner. */
const handoff = (pr: string, reason: string, runUrl: string): void => {
  const posted = safeSh(`gh pr comment ${pr} --body ${shellArg(failureComment(reason, runUrl))}`);
  if (posted.trim() === "")
    console.error("The failure comment may not have posted; check the log.");
  safeSh(`gh pr edit ${pr} --remove-label agent:review`);
  safeSh(`gh pr edit ${pr} --add-label ready-for-human`);
};

try {
  const pr = required("PR_NUMBER");
  const runUrl = required("RUN_URL");
  const action = failureAction({
    reviewFailed: process.env["REVIEW_FAILED"] === "true",
    retry: process.env["RETRY"] === "true",
  });
  if (action === "retry" && redispatch(pr)) {
    console.log(`Re-dispatched the review of #${pr} once.`);
  } else {
    const reason = failureReason(outputDir());
    handoff(pr, reason, runUrl);
    console.error(`Handed pull request #${pr} to a human:\n${reason}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
