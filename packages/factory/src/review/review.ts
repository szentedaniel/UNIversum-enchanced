/**
 * The factory's review step: Claude Code reviews one pull request with Matt
 * Pocock's `code-review` skill — Standards and Spec axes — commits the fixes
 * it is sure of, and emits the structured verdict the workflow turns into a
 * comment and a `risk:*` label. The workflow owns the push, the comment and
 * the labels; this script owns the run and the files it leaves behind.
 *
 * Env: PR_NUMBER, BRANCH, GH_REPO, CLAUDE_CODE_OAUTH_TOKEN, OUTPUT_DIR;
 * ISSUE_NUMBER is optional (the issue the pull request closes).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { riskLabel } from "#review/merge-danger.ts";
import { reviewSchema } from "#review/schema.ts";
import { parentIssue } from "#review/spec.ts";
import { summaryComment } from "#review/summary.ts";
import { reviewWithRetry, type StructuredFailure } from "#review/verdict.ts";
import { claudeAgent } from "#shared/agents.ts";
import { fail, outputDir, required, safeSh, sh } from "#shared/common.ts";

/**
 * The pull request, its issue and the issue's parent spec, as prompt context.
 * Every fetch is best-effort: a missing issue leaves the Spec axis with the
 * pull request's own body rather than stopping a review that can still run.
 */
const contextOf = (
  prNumber: string,
  issueNumber: string,
): {
  prContext: string;
  issueContext: string;
  issueLine: string;
} => {
  const prContext =
    safeSh(`gh pr view ${prNumber} --json title,body --jq '.title + "\\n\\n" + .body'`) ||
    `Pull request #${prNumber}.`;
  if (issueNumber === "") {
    return {
      prContext,
      issueContext: "",
      issueLine: "The pull request's body names no issue: use its body above as the spec.",
    };
  }
  const issueView = safeSh(`gh issue view ${issueNumber} --comments`);
  if (issueView === "") {
    return {
      prContext,
      issueContext: "",
      issueLine: `Issue #${issueNumber} could not be read: use the pull request's body, the commits and docs/ to find the spec.`,
    };
  }
  const parent = parentIssue(issueView);
  const parentSpec =
    parent === null ? "" : safeSh(`gh issue view ${parent} --json body --jq .body`);
  return {
    prContext,
    issueContext: [issueView, parentSpec === "" ? "" : `# Parent spec #${parent}\n\n${parentSpec}`]
      .filter((part) => part !== "")
      .join("\n\n"),
    issueLine: `The pull request closes issue #${issueNumber}; it and its parent spec are above.`,
  };
};

/**
 * The structured-output failure behind a thrown run, in the shape the retry
 * turn reads. Any other error is not retryable in the same session.
 */
const failureOf = (error: unknown): StructuredFailure | undefined => {
  if (!(error instanceof sandcastle.StructuredOutputError)) return undefined;
  return {
    message: error.message,
    cause: error.cause,
    rawMatched: error.rawMatched,
    sessionId: error.sessionId,
    commits: error.commits.length,
  };
};

try {
  const prNumber = required("PR_NUMBER");
  if (!/^\d+$/u.test(prNumber)) {
    fail(`PR_NUMBER must be a pull request number, got '${prNumber}'.`);
  }
  const branch = required("BRANCH");
  const issueNumber = process.env["ISSUE_NUMBER"] ?? "";
  if (issueNumber !== "" && !/^\d+$/u.test(issueNumber)) {
    fail(`ISSUE_NUMBER must be an issue number, got '${issueNumber}'.`);
  }

  const { prContext, issueContext, issueLine } = contextOf(prNumber, issueNumber);
  const options = {
    name: `review-#${prNumber}`,
    agent: claudeAgent("claude-sonnet-5-5"),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      PR_NUMBER: prNumber,
      BRANCH: branch,
      PR_CONTEXT: prContext,
      ISSUE_LINE: issueLine,
      ISSUE_CONTEXT: issueContext,
    },
    // Sandcastle 0.14's structured output only fits one iteration. A reply
    // that is missing or invalid gets one resumed turn from `reviewWithRetry`,
    // with the validation error in its prompt, rather than losing the review.
    maxIterations: 1,
    output: sandcastle.Output.object({ tag: "review", schema: reviewSchema }),
  } satisfies sandcastle.RunOptions;

  const outcome = await reviewWithRetry(async (resume) => {
    const result = await sandcastle.run(
      resume === undefined
        ? options
        : {
            ...options,
            prompt: resume.prompt,
            promptFile: undefined,
            promptArgs: undefined,
            resumeSession: resume.sessionId,
          },
    );
    return { review: result.output, commits: result.commits.length };
  }, failureOf);

  // The workflow pushes the commits; a fix left uncommitted would be lost
  // with the runner, and a clean tree keeps the push honest.
  const dirty = sh("git status --porcelain").trim();
  if (dirty !== "") {
    fail(`The reviewer left uncommitted changes:\n${dirty}`);
  }

  if (outcome.salvaged) {
    console.error(
      "\nThe retry still carried no merge danger: posting the verdict and findings, unrated.",
    );
  }

  const output = outputDir();
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "review.json"), `${JSON.stringify(outcome.review, null, 2)}\n`);
  writeFileSync(join(output, "comment.md"), `${summaryComment(outcome.review)}\n`);
  writeFileSync(join(output, "risk-label.txt"), `${riskLabel(outcome.review.mergeDanger)}\n`);
  console.log(
    `Review: ${outcome.review.verdict}, ${riskLabel(outcome.review.mergeDanger)}; ${String(outcome.commits)} fix commit(s), ${outcome.retried ? "retried" : "first reply"}.`,
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
