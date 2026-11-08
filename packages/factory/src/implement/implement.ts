/**
 * The factory's implement step: omp implements one ticket on the runner's
 * checkout of `agent/issue-<N>-<slug>` (no worktree, no sandbox). The
 * workflow around this script owns the labels, the push and the PR; this
 * script owns the run, the commits check and the report.
 *
 * Env: ISSUE_NUMBER, ISSUE_TITLE, BRANCH, OPENCODE_API_KEY, OUTPUT_DIR.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { reportFrom, reportStatus } from "#implement/report.ts";
import { ompAgent } from "#shared/agents.ts";
import { fail, outputDir, required, safeSh, sh } from "#shared/common.ts";

const issueNumber = required("ISSUE_NUMBER");
const issueTitle = required("ISSUE_TITLE");
const branch = required("BRANCH");

try {
  const issueContext =
    safeSh(`gh issue view ${issueNumber} --comments`) || `Issue #${issueNumber}: ${issueTitle}`;

  const result = await sandcastle.run({
    name: `implement-#${issueNumber}`,
    agent: ompAgent(),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      ISSUE_NUMBER: issueNumber,
      ISSUE_TITLE: issueTitle,
      BRANCH: branch,
      ISSUE_CONTEXT: issueContext,
    },
    // The loop goes agent → checks → commit on its own; five iterations leaves
    // room for a red check and its fix without burning the monthly budget.
    maxIterations: 5,
  });

  const commitsAhead = Number(sh("git rev-list --count origin/main..HEAD").trim());
  if (!Number.isFinite(commitsAhead) || commitsAhead === 0) {
    fail("Agent finished but no commits were made on the branch.");
  }

  const report = reportFrom(result.stdout);
  if (report === "") {
    fail("Agent finished but wrote no report.");
  }
  mkdirSync(outputDir(), { recursive: true });
  const reportPath = join(outputDir(), "report.md");
  writeFileSync(reportPath, `${report}\n`);

  // The workflow reads this to pick the exit: a blocked run keeps its branch
  // and asks on the issue; a done run opens the pull request.
  const status = reportStatus(report);
  writeFileSync(join(outputDir(), "status.txt"), `${status}\n`);

  console.log(`Implementation produced ${String(commitsAhead)} commit(s).`);
  console.log(`Commits this run: ${String(result.commits.length)}.`);
  console.log(`Report: ${reportPath} (${status})`);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
