/**
 * Red main: a failed CI run on `main` becomes the factory's next ticket. One
 * issue, `bug` + `ready-for-agent` + `priority:top`, carrying the failed jobs'
 * log tail; while one is open, the next red run comments on it instead of
 * opening a second. The dispatcher is started at once, because a red `main`
 * holds every later ticket's CI.
 *
 * Env: GH_REPO, CI_RUN_ID (the failed run), DRY_RUN.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { excerptOf } from "#fix/excerpt.ts";
import {
  RED_MAIN_MARKER,
  redMainBody,
  redMainIssue,
  redMainTitle,
  type RedMain,
} from "#maintain/red-main.ts";
import { fail, required, sh, shellArg } from "#shared/common.ts";
import { parseJson } from "#shared/github.ts";
import { runLog } from "#shared/runs.ts";

interface RunView {
  headSha: string;
  url: string;
  jobs: { name: string; conclusion: string | null }[];
}

interface OpenIssue {
  number: number;
  body: string | null;
}

const LABELS = ["bug", "ready-for-agent", "priority:top"];

/** The run's failed jobs and their log tail. */
const runOf = (repo: string, runId: string): RedMain => {
  const view = parseJson<RunView>(
    sh(
      `gh run view ${runId} --repo "${repo}" --json headSha,url,jobs --jq '{headSha: .headSha, url: .url, jobs: [.jobs[] | {name: .name, conclusion: .conclusion}]}'`,
    ),
  );
  const log = runLog(repo, runId, { failedOnly: true });
  return {
    commit: view.headSha,
    runUrl: view.url,
    jobs: view.jobs.filter((job) => job.conclusion === "failure").map((job) => job.name),
    excerpt: excerptOf(log) || "(no failed-step log output)",
  };
};

/** The open issues, whose bodies carry the dedupe marker. */
const openIssues = (repo: string): OpenIssue[] =>
  parseJson<OpenIssue[]>(
    sh(`gh issue list --repo "${repo}" --state open --limit 100 --json number,body`),
  );

/** The comment and the issue body differ only in the marker line. */
const withoutMarker = (body: string): string => body.replace(`${RED_MAIN_MARKER}\n`, "");

const writeTemp = (name: string, content: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-red-main-")), name);
  writeFileSync(file, content);
  return file;
};

const main = (): void => {
  const repo = required("GH_REPO");
  const runId = required("CI_RUN_ID");
  const dryRun = process.env["DRY_RUN"] === "1";
  const run = runOf(repo, runId);

  console.log(`Red main at ${run.commit.slice(0, 7)}: ${run.runUrl}`);
  console.log(`Failed jobs: ${run.jobs.length === 0 ? "(none reported)" : run.jobs.join(", ")}`);
  console.log(`Excerpt: ${String(run.excerpt.length)} characters`);

  const open = openIssues(repo);
  const existing = redMainIssue(open);

  if (existing !== undefined) {
    console.log(`#${String(existing)} already tracks a red main; commenting the new run there.`);
    if (dryRun) {
      console.log("Dry run: nothing was commented or dispatched.");
      return;
    }
    sh(
      `gh issue comment ${String(existing)} --repo "${repo}" --body-file "${writeTemp("comment.md", withoutMarker(redMainBody(run)))}"`,
    );
  } else if (dryRun) {
    console.log(`Would open "${redMainTitle(run)}" with ${LABELS.join(", ")}.`);
  } else {
    sh(
      `gh issue create --repo "${repo}" --title ${shellArg(redMainTitle(run))} --body-file "${writeTemp("issue.md", redMainBody(run))}" ${LABELS.map((label) => `--label ${shellArg(label)}`).join(" ")}`,
    );
    console.log(`Opened "${redMainTitle(run)}".`);
  }

  if (dryRun) {
    console.log("Dry run: the dispatcher was not started.");
    return;
  }
  // A red CI run is a push to main, which already started the dispatcher, but
  // that run saw neither this issue nor its `priority:top`.
  sh("gh workflow run factory-dispatch.yml");
  console.log("Started the dispatcher.");
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
