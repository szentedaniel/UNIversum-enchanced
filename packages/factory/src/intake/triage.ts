/**
 * The factory's triage step: for each issue waiting for triage, Claude reads a
 * checkout of `main` and returns a structured decision; this script posts the
 * comment and moves the label. Claude never writes: the issue's text (untrusted
 * input) cannot steer a `gh` call.
 *
 * Env: GH_REPO, CLAUDE_CODE_OAUTH_TOKEN (and GH_TOKEN for `gh`), OUTPUT_DIR,
 * FACTORY_INTAKE_MAX, ISSUE_NUMBER (optional, a dispatch's issue), DRY_RUN,
 * SCHEDULED (a tick dispatch must be inside the night window).
 */
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { optionalIssueNumber } from "#intake/gh.ts";
import { openIssues } from "#intake/issues.ts";
import { triageAction } from "#intake/render.ts";
import { triageSchema } from "#intake/schema.ts";
import {
  DEFAULT_INTAKE_MAX,
  intakeAllowed,
  triageCandidates,
  type IntakeIssue,
} from "#intake/select.ts";
import { changeSince, treeState } from "#intake/tree.ts";
import { commentOn, labelIssue, queueReady } from "#intake/writes.ts";
import { claudeAgent } from "#shared/agents.ts";
import { fail, positiveInt, required } from "#shared/common.ts";
import { gh } from "#shared/github.ts";

const MODEL = "claude-sonnet-5-5";

/** Classifies one issue and performs the one write its decision asks for. */
const triageOne = async (issue: IntakeIssue, dryRun: boolean): Promise<boolean> => {
  // The issue is the step's whole input: an unreadable one fails the run
  // rather than asking the owner questions about a body Claude never saw.
  const issueContext = gh(["issue", "view", String(issue.number), "--comments"]);

  const before = treeState();

  const result = await sandcastle.run({
    name: `triage-#${String(issue.number)}`,
    agent: claudeAgent(MODEL),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "triage-prompt.md"),
    promptArgs: {
      ISSUE_NUMBER: String(issue.number),
      ISSUE_TITLE: issue.title,
      ISSUE_CONTEXT: issueContext,
    },
    // Sandcastle 0.14 allows structured output only at one iteration.
    maxIterations: 1,
    output: sandcastle.Output.object({ tag: "triage", schema: triageSchema }),
  });

  const action = triageAction(result.output, issue.labels);
  console.log(`\n#${String(issue.number)} ${issue.title}`);
  console.log(`triage: ${result.output.kind}`);

  // A prompt that wrote to the checkout is a bug in the step; a write must
  // never follow it, or the comment would describe a tree nobody reviewed.
  const changed = changeSince(before);
  if (changed !== "") {
    fail(
      `The triage agent changed the checkout while reading #${String(issue.number)}:\n${changed}`,
    );
  }

  commentOn(issue.number, action.comment, dryRun);
  labelIssue(issue.number, action.add, action.remove, dryRun);
  return result.output.kind === "ready";
};

const main = async (): Promise<void> => {
  const repo = required("GH_REPO");
  if (!intakeAllowed({ scheduled: process.env["SCHEDULED"] === "true", at: new Date() })) {
    console.log("Outside the Budapest night window: a tick-dispatched intake run does nothing.");
    return;
  }

  const limit = positiveInt(process.env["FACTORY_INTAKE_MAX"], DEFAULT_INTAKE_MAX);
  const only = optionalIssueNumber("ISSUE_NUMBER");
  const dryRun = process.env["DRY_RUN"] === "1";
  const candidates = triageCandidates(openIssues(repo), limit, only);
  if (candidates.length === 0) {
    console.log("No issue is waiting for triage.");
    return;
  }

  console.log(
    `Triage (${String(candidates.length)}): ${candidates.map((issue) => `#${String(issue.number)}`).join(", ")}`,
  );
  const ready: number[] = [];
  const failures: string[] = [];
  for (const issue of candidates) {
    try {
      // Sequential on purpose: every run works in the same checkout, and the
      // month's Pro usage stays predictable.
      // oxlint-disable-next-line eslint/no-await-in-loop -- one Claude run at a time in one checkout
      if (await triageOne(issue, dryRun)) ready.push(issue.number);
    } catch (error) {
      failures.push(
        `#${String(issue.number)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!dryRun) queueReady(ready);
  if (failures.length > 0) {
    fail(`Triage failed for:\n- ${failures.join("\n- ")}`);
  }
  const listed = ready.map((number) => `#${String(number)}`).join(", ");
  if (ready.length === 0) console.log("Nothing became ready-for-agent.");
  else if (dryRun) console.log(`Would be ready for the dispatcher: ${listed} (dry run).`);
  else console.log(`Ready for the dispatcher: ${listed}.`);
};

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
