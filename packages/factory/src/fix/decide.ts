/**
 * The fix loop's gate: reads the rounds the pull request already used and the
 * failure the next round would fix, then either allows the run (`plan.json`
 * and `problem.md` for `fix.ts`) or writes the escalation comment for the
 * workflow. Plain node and `gh`: a spent round costs a minute, not a setup.
 *
 * Env: PR_NUMBER, BRANCH, FIX_REASON, CI_RUN_ID (optional), GH_REPO,
 * OUTPUT_DIR.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { excerptOf } from "#fix/excerpt.ts";
import { FIX_REASONS, fixReasonOf, type FixReason } from "#fix/reasons.ts";
import { fixDecision, fixReasonText, fixRounds, MAX_FIX_ROUNDS } from "#fix/rounds.ts";
import { newestMarkerComment, type ReviewComment } from "#review/summary.ts";
import { fail, outputDir, required, sh, shellArg } from "#shared/common.ts";
import { issueComments, parseJson } from "#shared/github.ts";

/** The hidden marker of the one escalation comment the loop posts. */
const ESCALATED_MARKER = "<!-- factory-fix:escalated -->";

/** How much of the failure the escalation comment carries; the prompt gets more. */
const ESCALATION_CHARS = 4000;

/** What `fix.ts` and the workflow read back. */
interface FixPlan {
  readonly run: boolean;
  readonly round: number | null;
  readonly reason: FixReason;
  /** Whether the workflow should post `escalation.md` and label the pull request. */
  readonly escalate: boolean;
}

const writePlan = (output: string, plan: FixPlan): void => {
  writeFileSync(join(output, "plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
};

const stdoutOf = (error: unknown): string => {
  if (typeof error === "object" && error !== null && "stdout" in error) {
    const { stdout } = error;
    if (typeof stdout === "string") return stdout;
  }
  return "";
};

/**
 * The failed jobs' logs. `--log-failed` can print far more than execSync's
 * default buffer, so the cap is explicit; `excerptOf` trims it to the prompt's
 * budget afterwards.
 */
const failedLog = (repo: string, runId: string): string => {
  try {
    return execSync(`gh run view ${runId} --repo "${repo}" --log-failed`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (error) {
    return stdoutOf(error);
  }
};

/** The branch's newest failed CI run: a dispatched `ci` run gets no run id. */
const latestFailedRun = (repo: string, branch: string): string => {
  const runs = parseJson<{ databaseId: number }[]>(
    sh(
      `gh run list --repo "${repo}" --workflow ci.yml --branch ${shellArg(branch)} --limit 20 --json databaseId,conclusion --jq '[.[] | select(.conclusion == "failure")]'`,
    ),
  );
  const newest = runs[0];
  return newest === undefined ? "" : String(newest.databaseId);
};

/** What omp is asked to fix, as the prompt's one context block. */
const problemOf = (
  reason: FixReason,
  repo: string,
  branch: string,
  comments: readonly ReviewComment[],
): string => {
  if (reason === "review") {
    const review = newestMarkerComment(comments);
    if (review !== undefined) return review.body;
    return fail("The pull request has no review comment to fix.");
  }
  if (reason === "ci") {
    const passed = process.env["CI_RUN_ID"] ?? "";
    const runId = passed === "" ? latestFailedRun(repo, branch) : passed;
    if (runId === "") fail(`No failed CI run found on ${branch}.`);
    return excerptOf(failedLog(repo, runId));
  }
  return [
    "main moved since this branch was cut, or merging it conflicts.",
    "",
    "Merge `origin/main` into this branch, resolve the conflicts, run the fast checks and commit.",
  ].join("\n");
};

const main = (): void => {
  const repo = required("GH_REPO");
  const pr = required("PR_NUMBER");
  const branch = required("BRANCH");
  const reason =
    fixReasonOf(required("FIX_REASON")) ??
    fail(`FIX_REASON must be one of ${FIX_REASONS.join(", ")}.`);

  const output = outputDir();
  mkdirSync(output, { recursive: true });

  const comments = issueComments(repo, pr);
  const problem = problemOf(reason, repo, branch, comments);
  writeFileSync(join(output, "problem.md"), `${problem}\n`);

  // Merging main in is housekeeping, not a fix round: main moving again is
  // not the pull request's failure.
  if (reason === "main-moved") {
    writePlan(output, { run: true, round: null, reason, escalate: false });
    console.log(`Fix run: ${reason}.`);
    return;
  }

  const decision = fixDecision(fixRounds(comments));
  if (decision.run) {
    writePlan(output, { run: true, round: decision.round, reason, escalate: false });
    console.log(
      `Fix round ${String(decision.round)} of ${String(MAX_FIX_ROUNDS)}: ${fixReasonText(reason)}.`,
    );
    return;
  }

  const escalated = comments.some((comment) => comment.body.includes(ESCALATED_MARKER));
  writePlan(output, { run: false, round: null, reason, escalate: !escalated });
  if (escalated) {
    console.log(`${decision.reason}; the escalation comment is already posted.`);
    return;
  }
  const body = [
    ESCALATED_MARKER,
    "## Factory fix: out of rounds",
    "",
    `The fix loop already ran ${String(MAX_FIX_ROUNDS)} rounds; this is what came back. A person decides now.`,
    "",
    `**Why:** ${fixReasonText(reason)}.`,
    "",
    excerptOf(problem, ESCALATION_CHARS),
    "",
  ].join("\n");
  writeFileSync(join(output, "escalation.md"), body);
  console.log(`Escalating: ${decision.reason}.`);
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
