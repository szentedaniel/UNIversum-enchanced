/**
 * The weekly architecture pass: Claude reads the hot spots of this codebase
 * with the `codebase-design` vocabulary and proposes at most two deep-module
 * refactors; the script opens the issues. "Claude decides, the script writes":
 * an issue only lands once the JSON is parsed, and a two-way door is the only
 * proposal an agent may take (`ready-for-agent`), the rest waits for the owner.
 *
 * Env: GH_REPO, CLAUDE_CODE_OAUTH_TOKEN, DRY_RUN, MAX_PROPOSALS (optional,
 * default 2), FOCUS (optional: space-separated paths the pass keeps to).
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import {
  architectureRun,
  newProposals,
  proposalIssueBody,
  proposalLabel,
  trackedBy,
  type Proposal,
  type TrackedWork,
} from "#maintain/proposals.ts";
import { claudeAgent } from "#shared/agents.ts";
import { safeSh, fail, required, sh, shellArg } from "#shared/common.ts";
import { parseJson } from "#shared/github.ts";
import { targetPathsIn } from "#shared/targets.ts";

/** The work labels that make an issue a ticket or a proposal, not a spec. */
const WORK_LABELS: Record<string, true> = {
  "ready-for-agent": true,
  "agent:in-progress": true,
  "agent:blocked": true,
  "ready-for-human": true,
};

/** How far back a closed issue still counts as recently filed work. */
const RECENT_CLOSED_DAYS = 30;

interface ListedIssue {
  number: number;
  title: string;
  body: string | null;
  labels: { name: string }[];
  subIssues: unknown[];
}

interface ListedPull {
  number: number;
  title: string;
  body: string | null;
  files: { path: string }[];
}

const trackedIssues = (repo: string, state: "open" | "closed", search?: string): TrackedWork[] => {
  const searchArg = search === undefined ? "" : ` --search ${shellArg(search)}`;
  return parseJson<ListedIssue[]>(
    sh(
      `gh issue list --repo "${repo}" --state ${state}${searchArg} --limit 200 --json number,title,body,labels,subIssues`,
    ),
  ).flatMap((issue) => {
    if (issue.subIssues.length > 0) return [];
    if (!issue.labels.some((label) => WORK_LABELS[label.name] === true)) return [];
    return [
      {
        number: issue.number,
        title: issue.title,
        paths: targetPathsIn(`${issue.title}\n${issue.body ?? ""}`),
      },
    ];
  });
};

const trackedPulls = (repo: string): TrackedWork[] =>
  parseJson<ListedPull[]>(
    sh(`gh pr list --repo "${repo}" --state open --limit 100 --json number,title,body,files`),
  ).map((pull) => ({
    number: pull.number,
    title: pull.title,
    paths: [
      ...targetPathsIn(`${pull.title}\n${pull.body ?? ""}`),
      ...pull.files.map((file) => file.path),
    ],
  }));

/**
 * The open and recently closed work a proposal must not repeat: the open
 * issues, the closed issues of the last month, and the open pull requests.
 */
const trackedWork = (repo: string, now: Date): TrackedWork[] => {
  const since = new Date(now.getTime() - RECENT_CLOSED_DAYS * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);
  return [
    ...trackedIssues(repo, "open"),
    ...trackedIssues(repo, "closed", `closed:>=${since} sort:updated-desc`),
    ...trackedPulls(repo),
  ];
};

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
  const now = new Date();
  const { focus, schema, promptArgs } = architectureRun(
    { MAX_PROPOSALS: process.env["MAX_PROPOSALS"], FOCUS: process.env["FOCUS"] },
    now,
  );

  const result = await sandcastle.run({
    name: "architecture",
    agent: claudeAgent("claude-sonnet-5-5"),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      ...promptArgs,
      // The pass looks where the code keeps changing; the log is the pointer.
      RECENT_COMMITS:
        safeSh(`git log --oneline -80 -- ${focus.map(shellArg).join(" ")}`) ||
        "(no commit history)",
    },
    // Sandcastle 0.14 allows structured output only at one iteration, as the
    // review step does.
    maxIterations: 1,
    output: sandcastle.Output.object({ tag: "proposals", schema }),
  });

  const proposals = result.output.proposals;
  if (proposals.length === 0) {
    console.log("The pass proposed nothing this week.");
    return;
  }
  for (const proposal of proposals) console.log(`Proposed: ${describe(proposal)}`);

  const tracked = trackedWork(repo, now);
  const fresh = newProposals(proposals, tracked);
  for (const proposal of proposals) {
    if (fresh.includes(proposal)) continue;
    const work = trackedBy(proposal, tracked);
    console.log(
      work === undefined
        ? `Already tracked: "${proposal.title}".`
        : `Already tracked: "${proposal.title}" overlaps #${String(work.number)} ${work.title}.`,
    );
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
