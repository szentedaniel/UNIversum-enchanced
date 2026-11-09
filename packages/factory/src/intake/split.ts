/**
 * The factory's split step: for each spec the owner approved, Claude turns the
 * approved text into tracer-bullet tickets; this script rewrites the parent's
 * body, creates the children as sub-issues with their blocking edges, posts
 * each child's Implementation context comment and hands the parent to `factory`.
 *
 * Env: GH_REPO, CLAUDE_CODE_OAUTH_TOKEN (and GH_TOKEN for `gh`), OUTPUT_DIR,
 * FACTORY_INTAKE_MAX, ISSUE_NUMBER (optional, a dispatch's spec), DRY_RUN,
 * GITHUB_EVENT_NAME.
 */
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { optionalIssueNumber } from "#intake/gh.ts";
import { issueView, openIssues } from "#intake/issues.ts";
import { approvedSpecOf, childBody, specBody } from "#intake/render.ts";
import { splitProblems, splitSchema, type SplitTicket } from "#intake/schema.ts";
import {
  DEFAULT_INTAKE_MAX,
  FACTORY_LABEL,
  intakeAllowed,
  READY_FOR_AGENT,
  SPEC_APPROVED,
  splitCandidates,
  type IntakeIssue,
} from "#intake/select.ts";
import { changeSince, treeState } from "#intake/tree.ts";
import {
  addBlocker,
  attachSubIssue,
  commentOn,
  createIssue,
  issueIdOf,
  labelIssue,
  queueReady,
  rewriteBody,
  type ChildIssue,
} from "#intake/writes.ts";
import { claudeAgent } from "#shared/agents.ts";
import { fail, positiveInt, required } from "#shared/common.ts";

const MODEL = "claude-sonnet-5-5";

/**
 * Creates one ticket and attaches it as a sub-issue before the next exists: a
 * failure then leaves the parent with a sub-issue, which is what keeps the next
 * night from splitting the same spec twice.
 */
const createTickets = (
  repo: string,
  parent: number,
  tickets: readonly SplitTicket[],
): { child: ChildIssue; ticket: SplitTicket }[] => {
  const created: { child: ChildIssue; ticket: SplitTicket }[] = [];
  for (const ticket of tickets) {
    const number = createIssue(ticket.title, childBody(parent, ticket.body), [READY_FOR_AGENT]);
    const child = { number, id: issueIdOf(repo, number) };
    attachSubIssue(repo, parent, child, false);
    created.push({ child, ticket });
  }
  return created;
};

/** Turns one approved spec into tickets; returns the new issue numbers. */
const splitOne = async (repo: string, issue: IntakeIssue, dryRun: boolean): Promise<number[]> => {
  const view = issueView(issue.number);
  const spec = approvedSpecOf({ body: view.body, comments: view.comments });
  if (spec === null) {
    throw new Error(
      "no approved spec text: no comment carries the factory-spec markers and the body is empty.",
    );
  }

  const before = treeState();

  const result = await sandcastle.run({
    name: `split-#${String(issue.number)}`,
    agent: claudeAgent(MODEL),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "split-prompt.md"),
    promptArgs: {
      ISSUE_NUMBER: String(issue.number),
      ISSUE_TITLE: view.title,
      ISSUE_BODY: view.body,
      SPEC: spec,
    },
    // Sandcastle 0.14 allows structured output only at one iteration.
    maxIterations: 1,
    output: sandcastle.Output.object({ tag: "split", schema: splitSchema }),
  });

  console.log(`\n#${String(issue.number)} ${view.title}`);
  console.log(`split: ${String(result.output.tickets.length)} ticket(s)`);

  // Validate before the first write: a bad plan must leave the repo untouched.
  const problems = splitProblems(result.output);
  if (problems.length > 0) {
    throw new Error(`the split plan is invalid:\n  - ${problems.join("\n  - ")}`);
  }
  const changed = changeSince(before);
  if (changed !== "") {
    fail(
      `The split agent changed the checkout while reading #${String(issue.number)}:\n${changed}`,
    );
  }

  if (dryRun) {
    console.log(
      `  would rewrite #${String(issue.number)}'s body with:\n\n${specBody(result.output.spec)}\n`,
    );
    for (const ticket of result.output.tickets) {
      const blockedBy = [...new Set(ticket.blockedBy)]
        .map((dependency) => `ticket ${String(dependency)}`)
        .join(", ");
      console.log(
        `  would create "${ticket.title}" (blocked by: ${blockedBy === "" ? "nothing" : blockedBy}) with:\n\n${childBody(issue.number, ticket.body)}\n  and post this context comment:\n\n${ticket.context}\n`,
      );
    }
    console.log(
      `  would attach the ${String(result.output.tickets.length)} new issues as sub-issues of #${String(issue.number)}, add the blocking edges, and move #${String(issue.number)} from ${SPEC_APPROVED} to ${FACTORY_LABEL}.`,
    );
    return [];
  }

  const created = createTickets(repo, issue.number, result.output.tickets);
  for (const { child, ticket } of created) {
    for (const dependency of new Set(ticket.blockedBy)) {
      const blocker = created[dependency];
      if (blocker === undefined) {
        throw new Error(`blockedBy index ${String(dependency)} is outside the ticket list.`);
      }
      addBlocker(repo, child, blocker.child, false);
    }
    commentOn(child.number, ticket.context, false);
  }
  rewriteBody(issue.number, specBody(result.output.spec), false);
  labelIssue(issue.number, [FACTORY_LABEL], [SPEC_APPROVED], false);
  return created.map(({ child }) => child.number);
};

const main = async (): Promise<void> => {
  const repo = required("GH_REPO");
  if (!intakeAllowed({ eventName: process.env["GITHUB_EVENT_NAME"] ?? "", at: new Date() })) {
    console.log("Outside the Budapest night window: a scheduled intake run does nothing.");
    return;
  }

  const limit = positiveInt(process.env["FACTORY_INTAKE_MAX"], DEFAULT_INTAKE_MAX);
  const only = optionalIssueNumber("ISSUE_NUMBER");
  const dryRun = process.env["DRY_RUN"] === "1";
  const specs = splitCandidates(openIssues(repo), limit, only);
  if (specs.length === 0) {
    console.log("No approved spec is waiting to split.");
    return;
  }

  console.log(
    `Split (${String(specs.length)}): ${specs.map((issue) => `#${String(issue.number)}`).join(", ")}`,
  );
  const children: number[] = [];
  const failures: string[] = [];
  for (const spec of specs) {
    try {
      // Sequential on purpose: every run works in the same checkout, and the
      // month's Pro usage stays predictable.
      // oxlint-disable-next-line eslint/no-await-in-loop -- one Claude run at a time in one checkout
      children.push(...(await splitOne(repo, spec, dryRun)));
    } catch (error) {
      failures.push(
        `#${String(spec.number)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  if (!dryRun) queueReady(children);
  if (failures.length > 0) {
    fail(`Split failed for:\n- ${failures.join("\n- ")}`);
  }
  if (dryRun) console.log("Dry run: nothing was written.");
  else if (children.length === 0) console.log("No ticket was created.");
  else console.log(`Created ${children.map((number) => `#${String(number)}`).join(", ")}.`);
};

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
