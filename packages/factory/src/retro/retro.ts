/**
 * The nightly retro's run: Claude reads the day's facts and the open issues,
 * picks the recurring problems and their cheapest durable fixes, and answers
 * with JSON only. The script then performs every write through `writes.ts`: a
 * `ready-for-agent` issue, a `retro/<date>-<slug>` pull request labelled
 * `ready-for-human` (applied with `git apply --check` first) for a standards or
 * workflow change, or nothing. Then it appends the dated entry to the factory
 * log and commits that straight to `main` with `[skip ci]`.
 *
 * Env: GH_REPO, CLAUDE_CODE_OAUTH_TOKEN, OUTPUT_DIR (holds `facts.json`),
 * FACTORY_RETRO_MAX (optional, default 3), DRY_RUN.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { noSandbox } from "@ai-hero/sandcastle/sandboxes/no-sandbox";
import { hasActivity, type RetroFacts } from "#retro/collect.ts";
import {
  appendLog,
  DEFAULT_MAX_WRITES,
  hasLogFor,
  LOG_FILE,
  logSection,
  planWrites,
} from "#retro/plan.ts";
import { retroSchema } from "#retro/schema.ts";
import { applyWrites, shellIo } from "#retro/writes.ts";
import { claudeAgent } from "#shared/agents.ts";
import { fail, outputDir, positiveInt, required, sh, shellArg } from "#shared/common.ts";
import { parseJson } from "#shared/github.ts";

const readLog = (): string | undefined =>
  existsSync(LOG_FILE) ? readFileSync(LOG_FILE, "utf8") : undefined;

const main = async (): Promise<void> => {
  const repo = required("GH_REPO");
  const date = new Date().toISOString().slice(0, 10);
  if (process.env["DRY_RUN"] !== "1" && hasLogFor(readLog(), date)) {
    console.log(`The retro already ran for ${date}; this run has nothing to add.`);
    return;
  }
  const facts = parseJson<RetroFacts>(readFileSync(join(outputDir(), "facts.json"), "utf8"));
  if (!hasActivity(facts)) {
    console.log("No factory activity in the last day; there is nothing to retro.");
    return;
  }

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
    // One pass: the retro decides, it does not run a loop of fixes. A bad tag
    // or schema gets one resumed retry, so a long patch does not lose the night.
    maxIterations: 1,
    output: sandcastle.Output.object({ tag: "retro", schema: retroSchema, maxRetries: 1 }),
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

  const { opened, skipped } = applyWrites(plan.writes, repo, shellIo);

  // The push to main is the last write: main may have moved while Claude read.
  sh("git fetch origin main");
  sh("git merge --ff-only origin/main");
  const existingLog = readLog();
  const bullets = [
    ...result.output.logEntry,
    ...opened,
    ...plan.skipped,
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
