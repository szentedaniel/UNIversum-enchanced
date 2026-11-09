/**
 * The weekly flaky-test pass: reads the last seven days of `CI` runs' logs,
 * takes Playwright's own `N flaky` summaries, and opens one `bug` +
 * `ready-for-agent` issue per test — deduped on the issue title, so a test
 * that stays flaky keeps its first issue.
 *
 * Env: GH_REPO, DRY_RUN.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  flakyIssueBody,
  flakyIssueTitle,
  flakyTestsOf,
  newFlakyTests,
  testNameOf,
  type FlakyRun,
  type FlakyTest,
} from "#maintain/flaky.ts";
import { fail, required, sh, shellArg } from "#shared/common.ts";
import { parseJson } from "#shared/github.ts";

/** The spec's window: the last week of CI history. */
const WINDOW_DAYS = 7;

const LABELS = ["bug", "ready-for-agent"];

interface ApiRun {
  databaseId: number;
  createdAt: string;
  status: string;
  url: string;
}

const runsInWindow = (repo: string, now: Date): ApiRun[] => {
  const since = now.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000;
  return parseJson<ApiRun[]>(
    sh(
      `gh run list --repo "${repo}" --workflow ci.yml --limit 100 --json databaseId,createdAt,status,url`,
    ),
  ).filter((run) => run.status === "completed" && Date.parse(run.createdAt) >= since);
};

/**
 * A run's log, or an empty string when GitHub no longer holds it: an expired
 * log is not a reason to fail the weekly pass.
 */
const logOf = (repo: string, runId: number): string => {
  try {
    return execSync(`gh run view ${String(runId)} --repo "${repo}" --log`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 128 * 1024 * 1024,
    });
  } catch (error) {
    if (typeof error === "object" && error !== null && "stdout" in error) {
      return typeof error.stdout === "string" ? error.stdout : "";
    }
    return "";
  }
};

const keyOf = (test: FlakyTest): string => testNameOf(test);

/** Every flaky test in the window, with the runs that retried it. */
const flakyOf = (
  repo: string,
  runs: readonly ApiRun[],
): Map<string, { test: FlakyTest; runs: FlakyRun[] }> => {
  const found = new Map<string, { test: FlakyTest; runs: FlakyRun[] }>();
  for (const run of runs) {
    const log = logOf(repo, run.databaseId);
    if (log === "") {
      console.log(`Run ${String(run.databaseId)}: no log available.`);
      continue;
    }
    for (const test of flakyTestsOf(log)) {
      const key = keyOf(test);
      const entry = found.get(key) ?? { test, runs: [] };
      entry.runs.push({ url: run.url, createdAt: run.createdAt });
      found.set(key, entry);
    }
  }
  return found;
};

const openTitles = (repo: string): string[] =>
  parseJson<{ title: string }[]>(
    sh(`gh issue list --repo "${repo}" --state open --limit 200 --json title`),
  ).map((issue) => issue.title);

const writeTemp = (content: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-flaky-")), "issue.md");
  writeFileSync(file, content);
  return file;
};

const main = (): void => {
  const repo = required("GH_REPO");
  const dryRun = process.env["DRY_RUN"] === "1";
  const runs = runsInWindow(repo, new Date());

  console.log(
    `Flaky-test pass — ${String(runs.length)} CI run(s) in the last ${String(WINDOW_DAYS)} days`,
  );
  const found = flakyOf(repo, runs);
  if (found.size === 0) {
    console.log("No flaky test in the window; nothing to open.");
    return;
  }

  const tests = [...found.values()].map((entry) => entry.test);
  const fresh = newFlakyTests(tests, openTitles(repo));
  console.log(`Flaky: ${tests.map((test) => testNameOf(test)).join("; ") || "(none)"}`);

  if (fresh.length === 0) {
    console.log("Every flaky test already has an open issue.");
    return;
  }

  for (const test of fresh) {
    const title = flakyIssueTitle(test);
    if (dryRun) {
      console.log(`Would open "${title}" with ${LABELS.join(", ")}.`);
      continue;
    }
    const runsFor = found.get(keyOf(test))?.runs ?? [];
    sh(
      `gh issue create --repo "${repo}" --title ${shellArg(title)} --body-file "${writeTemp(flakyIssueBody(test, runsFor))}" ${LABELS.map((label) => `--label ${shellArg(label)}`).join(" ")}`,
    );
    console.log(`Opened "${title}".`);
  }
  if (dryRun) console.log("Dry run: nothing was opened.");
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
