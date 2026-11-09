/**
 * The factory's fix step: omp repairs one pull request's branch — a failed CI
 * run, the review's findings, or main that moved — and commits. `decide.ts`
 * wrote the round and the failure context; the workflow owns the push, the
 * comment and the labels.
 *
 * Env: PR_NUMBER, BRANCH, FIX_REASON, FIX_ROUND (the counted round, empty for
 * main-moved), OPENCODE_API_KEY, OUTPUT_DIR.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { fixReasonOf } from "#fix/reasons.ts";
import { mainMovedComment, MAX_FIX_ROUNDS, roundComment } from "#fix/rounds.ts";
import { reportFrom, reportStatus } from "#implement/report.ts";
import { ompAgent } from "#shared/agents.ts";
import { fail, outputDir, required, safeSh, sh } from "#shared/common.ts";

/**
 * `git merge origin/main`'s outcome. A conflict is aborted so the agent starts
 * from a clean tree and makes the merge itself, as its prompt says.
 */
const mergeMain = (): "up-to-date" | "merged" | "conflict" => {
  try {
    const output = sh("git merge --no-ff --no-edit origin/main");
    return output.includes("Already up to date") ? "up-to-date" : "merged";
  } catch {
    safeSh("git merge --abort");
    return "conflict";
  }
};

const main = async (): Promise<void> => {
  const pr = required("PR_NUMBER");
  const branch = required("BRANCH");
  const reason =
    fixReasonOf(required("FIX_REASON")) ?? fail("FIX_REASON must be ci, review or main-moved.");
  const round = process.env["FIX_ROUND"] ?? "";
  if (reason !== "main-moved" && !/^\d+$/u.test(round)) {
    fail(`FIX_ROUND must be the counted round for ${reason}, got '${round}'.`);
  }
  const problem = readFileSync(join(outputDir(), "problem.md"), "utf8");

  const output = outputDir();
  mkdirSync(output, { recursive: true });
  const commentPath = join(output, "fix-comment.md");

  // A merge with no conflicts needs no agent: git's merge commit is allowed
  // by the commit rules, and CI checks the result either way.
  if (reason === "main-moved" && mergeMain() !== "conflict") {
    writeFileSync(commentPath, `${mainMovedComment()}\n`);
    console.log("main was merged into the branch without conflicts.");
    return;
  }

  const tip = sh("git rev-parse HEAD").trim();
  const result = await sandcastle.run({
    name: `fix-#${pr}`,
    agent: ompAgent(),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      PR_NUMBER: pr,
      BRANCH: branch,
      ROUND: round === "" ? "not counted (main moved)" : `${round} of ${MAX_FIX_ROUNDS}`,
      PROBLEM: problem,
    },
    maxIterations: 5,
  });

  const report = reportFrom(result.stdout);
  if (reportStatus(report) === "BLOCKED") {
    fail(report === "" ? "The agent stopped without a report." : report);
  }

  // The workflow pushes the commits; a fix left uncommitted would be lost with
  // the runner, and a clean tree keeps the push honest.
  const dirty = sh("git status --porcelain").trim();
  if (dirty !== "") {
    fail(`The agent left uncommitted changes:\n${dirty}`);
  }
  if (sh("git rev-parse HEAD").trim() === tip) {
    fail("The agent finished but made no commit.");
  }

  const comment =
    reason === "main-moved" ? mainMovedComment() : roundComment(Number(round), reason);
  writeFileSync(commentPath, `${comment}\n`);
  console.log(`Fix committed on ${branch}.`);
};

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
