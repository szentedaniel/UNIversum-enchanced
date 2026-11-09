/**
 * The nightly retro's run: Claude reads the day's facts and the open issues,
 * picks the recurring problems and their cheapest durable fixes, and answers
 * with JSON only. The script performs every write: a `ready-for-agent` issue,
 * a `retro/<date>-<slug>` pull request labelled `ready-for-human` (applied
 * with `git apply --check` first), a `ready-for-human` workflow issue carrying
 * the patch, or nothing. Then it appends the dated entry to the factory log
 * and commits that straight to `main` with `[skip ci]`.
 *
 * Env: GH_REPO, CLAUDE_CODE_OAUTH_TOKEN, OUTPUT_DIR (holds `facts.json`),
 * FACTORY_RETRO_MAX (optional, default 3), DRY_RUN.
 */
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { hasActivity, type RetroFacts } from "#retro/collect.ts";
import {
  appendLog,
  commitSubjectOf,
  DEFAULT_MAX_WRITES,
  LOG_FILE,
  logSection,
  planWrites,
  type PlannedWrite,
} from "#retro/plan.ts";
import { retroSchema } from "#retro/schema.ts";
import { claudeAgent } from "#shared/agents.ts";
import { fail, outputDir, positiveInt, required, safeSh, sh, shellArg } from "#shared/common.ts";
import { parseJson } from "#shared/github.ts";

const writeTemp = (name: string, content: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-retro-")), name);
  writeFileSync(file, `${content}\n`);
  return file;
};

/** `gh issue create` prints the new issue's URL; its last segment is the number. */
const issueNumberOf = (url: string): string => {
  const number = url.trim().split("\n").at(-1)?.split("/").at(-1) ?? "";
  if (!/^\d+$/u.test(number)) fail(`gh printed no issue URL: ${url.trim()}`);
  return number;
};

const createIssue = (repo: string, title: string, body: string, label: string): string =>
  issueNumberOf(
    sh(
      `gh issue create --repo "${repo}" --title ${shellArg(title)} --body-file "${writeTemp("issue.md", body)}" --label ${shellArg(label)}`,
    ),
  );

/**
 * The standards pull request: a branch with the patch, pushed with the PAT so
 * CI runs on it, and a `ready-for-human` pull request (it touches a protected
 * path; the owner merges). A patch that no longer applies is a skip, not a
 * failed night; a push or PR failure is real and stops the run.
 */
const openStandardsPull = (
  repo: string,
  write: Extract<PlannedWrite, { kind: "standards-pr" }>,
  skipped: string[],
): string | undefined => {
  if (safeSh(`git ls-remote --heads origin ${shellArg(write.branch)}`).trim() !== "") {
    skipped.push(`"${write.title}": branch ${write.branch} already exists`);
    return undefined;
  }
  const patchFile = writeTemp("retro.patch", write.patch);
  try {
    sh(`git apply --check ${shellArg(patchFile)}`);
  } catch {
    skipped.push(`"${write.title}": the patch does not apply to main`);
    return undefined;
  }

  sh(`git checkout -b ${shellArg(write.branch)}`);
  try {
    sh(`git apply ${shellArg(patchFile)}`);
    sh("git add -A");
    sh(`git commit -m ${shellArg(commitSubjectOf(write.title))}`);
    sh(`git push origin ${shellArg(`HEAD:${write.branch}`)}`);
    return issueNumberOf(
      sh(
        `gh pr create --repo "${repo}" --base main --head ${shellArg(write.branch)} --title ${shellArg(write.title)} --body-file "${writeTemp("pull.md", write.body)}" --label ready-for-human`,
      ),
    );
  } finally {
    sh("git checkout main");
  }
};

const main = async (): Promise<void> => {
  const repo = required("GH_REPO");
  const facts = parseJson<RetroFacts>(readFileSync(join(outputDir(), "facts.json"), "utf8"));
  if (!hasActivity(facts)) {
    console.log("No factory activity in the last day; there is nothing to retro.");
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const maxWrites = positiveInt(process.env["FACTORY_RETRO_MAX"], DEFAULT_MAX_WRITES);
  const { openIssues, openPulls, ...day } = facts;
  const treeBefore = sh("git status --porcelain").trim();
  const result = await sandcastle.run({
    name: "factory-retro",
    agent: claudeAgent("claude-sonnet-5-5"),
    sandbox: noSandbox(),
    logging: { type: "stdout" },
    promptFile: join(import.meta.dirname, "prompt.md"),
    promptArgs: {
      DATE: date,
      WINDOW: `${facts.window.since} → ${facts.window.until}`,
      FACTS: JSON.stringify(day, null, 2),
      OPEN: JSON.stringify({ issues: openIssues, pulls: openPulls }, null, 2),
      MAX_WRITES: maxWrites,
    },
    // One pass: the retro decides, it does not run a loop of fixes.
    maxIterations: 1,
    output: sandcastle.Output.object({ tag: "retro", schema: retroSchema }),
  });

  // The agent answers; every write is this script's. A change it left behind
  // would be lost with the runner, so the tree must be where it started.
  const dirty = sh("git status --porcelain").trim();
  if (dirty !== treeBefore) {
    fail(`The retro agent changed the working tree; it must only answer:\n${dirty}`);
  }

  const plan = planWrites({
    findings: result.output.findings,
    existing: [
      ...openIssues.map((issue) => ({ number: issue.number, title: issue.title })),
      ...openPulls.map((pull) => ({ number: pull.number, title: pull.title })),
    ],
    date,
    maxWrites,
  });

  if (process.env["DRY_RUN"] === "1") {
    console.log(JSON.stringify(result.output, null, 2));
    console.log(`\nWould write ${String(plan.writes.length)} of at most ${String(maxWrites)}:`);
    for (const write of plan.writes) console.log(`- ${write.kind}: ${write.title}`);
    for (const skip of plan.skipped) console.log(`- skipped: ${skip}`);
    console.log("\nThe log entry it would append:\n");
    console.log(logSection(date, result.output.logEntry));
    return;
  }

  const skipped = [...plan.skipped];
  const opened: string[] = [];
  for (const write of plan.writes) {
    if (write.kind === "issue") {
      const number = createIssue(repo, write.title, write.body, "ready-for-agent");
      opened.push(`Opened #${number}: ${write.title}`);
    } else if (write.kind === "workflow-issue") {
      const number = createIssue(repo, write.title, write.body, "ready-for-human");
      opened.push(`Proposed workflow change in #${number}: ${write.title}`);
    } else {
      const number = openStandardsPull(repo, write, skipped);
      if (number !== undefined) {
        opened.push(`Opened pull request #${number}: ${write.title} (${write.branch})`);
      }
    }
  }

  // The push to main is the last write: main may have moved while Claude read.
  sh("git fetch origin main");
  sh("git merge --ff-only origin/main");
  const existingLog = existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : undefined;
  const bullets = [
    ...result.output.logEntry,
    ...opened,
    ...skipped.map((skip) => `Skipped: ${skip}`),
  ];
  writeFileSync(LOG_FILE, appendLog(existingLog, date, bullets));
  sh(`git add ${shellArg(LOG_FILE)}`);
  sh(`git commit -m ${shellArg(`docs(factory): retro log ${date}`)} -m ${shellArg("[skip ci]")}`);
  sh("git push origin HEAD:main");
  console.log(`Retro ${date}: ${String(opened.length)} write(s); the log is on main.`);
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
