/**
 * The weekly architecture pass: Claude reads the hot spots of this codebase
 * with the `codebase-design` vocabulary and proposes at most two deep-module
 * refactors; the script opens the issues. "Claude decides, the script writes":
 * an issue only lands once the JSON is parsed, and a two-way door is the only
 * proposal an agent may take (`ready-for-agent`), the rest waits for the owner.
 *
 * Env: GH_REPO, CLAUDE_CODE_OAUTH_TOKEN, DRY_RUN.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import {
  newProposals,
  proposalIssueBody,
  proposalLabel,
  proposalsSchema,
  type Proposal,
} from "#maintain/proposals.ts";
import { claudeAgent } from "#shared/agents.ts";
import { safeSh, fail, required, sh, shellArg } from "#shared/common.ts";
import { parseJson } from "#shared/github.ts";

const openTitles = (repo: string): string[] =>
  parseJson<{ title: string }[]>(
    sh(`gh issue list --repo "${repo}" --state open --limit 200 --json title`),
  ).map((issue) => issue.title);

const writeTemp = (proposal: Proposal): string => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-architecture-")), "issue.md");
  writeFileSync(file, proposalIssueBody(proposal));
  return file;
};

const describe = (proposal: Proposal): string =>
  `${proposal.title} (${proposal.twoWayDoor ? "two-way" : "one-way"} door)`;

const main = async (): Promise<void> => {
  const repo = required("GH_REPO");
  const dryRun = process.env["DRY_RUN"] === "1";

  const result = await sandcastle.run({
    name: "architecture",
    agent: claudeAgent("claude-sonnet-5-5"),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      DATE: new Date().toISOString().slice(0, 10),
      // The pass looks where the code keeps changing; the log is the pointer.
      RECENT_COMMITS: safeSh("git log --oneline -80") || "(no commit history)",
    },
    // Sandcastle 0.14 allows structured output only at one iteration, as the
    // review step does.
    maxIterations: 1,
    output: sandcastle.Output.object({ tag: "proposals", schema: proposalsSchema }),
  });

  const proposals = result.output.proposals;
  if (proposals.length === 0) {
    console.log("The pass proposed nothing this week.");
    return;
  }
  for (const proposal of proposals) console.log(`Proposed: ${describe(proposal)}`);

  const fresh = newProposals(proposals, openTitles(repo));
  for (const proposal of proposals) {
    if (!fresh.includes(proposal)) console.log(`Already open: "${proposal.title}".`);
  }

  for (const proposal of fresh) {
    if (dryRun) {
      console.log(`Would open "${proposal.title}" with ${proposalLabel(proposal)}.`);
      continue;
    }
    sh(
      `gh issue create --repo "${repo}" --title ${shellArg(proposal.title)} --body-file "${writeTemp(proposal)}" --label ${shellArg(proposalLabel(proposal))}`,
    );
    console.log(`Opened "${proposal.title}" with ${proposalLabel(proposal)}.`);
  }
  if (dryRun) console.log("Dry run: nothing was opened.");
};

try {
  await main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
