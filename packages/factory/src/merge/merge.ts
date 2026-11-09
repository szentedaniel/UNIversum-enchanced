/**
 * The factory's merge gate: reads one pull request's facts — the CI runs on
 * its head, the review comment, the labels, the changed files and the
 * package.json diffs — then merges it, waits for a run still in flight, queues
 * the re-review a push needs, sends the fix loop after main, or hands the
 * reasons to the owner. `DRY_RUN=1` prints what it would do and writes nothing.
 *
 * Env: PR_NUMBER, GH_REPO, GH_TOKEN (the PAT, in the workflow), DRY_RUN.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  dependencyMap,
  isFactoryPull,
  mergeStep,
  type CiRun,
  type DependencyChange,
  type MergeFacts,
} from "#merge/gates.ts";
import { closingIssue } from "#shared/closing-pr.ts";
import { fail, required, sh, shellArg } from "#shared/common.ts";
import { issueComments, parseJson } from "#shared/github.ts";

/** The fields of `gh pr view` the gate reads, as the jq object below. */
interface PullView {
  number: number;
  state: string;
  title: string;
  body: string | null;
  headRefName: string;
  headRefOid: string;
  mergeStateStatus: string;
  labels: string[];
  closing: number[];
  headCommittedAt: string;
}

/** What `repos/…/compare/<head>...main` says about the base branch. */
interface CompareView {
  mergeBase: string;
  /** `ahead_by` for `<head>...main`: how far main is ahead of the pull request. */
  mainAheadBy: number;
  files: string[];
}

const PULL_FIELDS =
  "number,state,title,body,headRefName,headRefOid,mergeStateStatus,labels,closingIssuesReferences,commits";

const pullOf = (repo: string, pr: string): PullView => {
  const raw = sh(
    `gh pr view ${pr} --repo "${repo}" --json ${PULL_FIELDS} --jq '{number, state, title, body, headRefName, headRefOid, mergeStateStatus: (.mergeStateStatus // "unknown"), labels: [.labels[].name], closing: [.closingIssuesReferences[].number], headCommittedAt: (.commits | last | .committedDate // "")}'`,
  );
  return parseJson<PullView>(raw);
};

/** Every file the pull request changes, as the files API sees them. */
const changedFiles = (repo: string, pr: string): string[] =>
  sh(`gh api "repos/${repo}/pulls/${pr}/files?per_page=100" --paginate --jq '.[].filename'`)
    .split("\n")
    .filter((line) => line !== "");

/** The CI runs on the pull request's branch; the gate picks the head's newest. */
const ciRuns = (repo: string, branch: string): CiRun[] =>
  parseJson<CiRun[]>(
    sh(
      `gh api "repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=50" --jq '[.workflow_runs[] | {headSha: .head_sha, status: .status, conclusion: .conclusion, createdAt: .created_at}]'`,
    ),
  );

/** What main holds that the head does not: its files and how many commits. */
const compareOf = (repo: string, headSha: string): CompareView =>
  parseJson<CompareView>(
    sh(
      `gh api "repos/${repo}/compare/${headSha}...main" --jq '{mergeBase: .merge_base_commit.sha, mainAheadBy: .ahead_by, files: [.files[].filename]}'`,
    ),
  );

/** A file's content at a ref, or `undefined` when it does not exist there. */
const contentAt = (repo: string, path: string, ref: string): string | undefined => {
  try {
    return sh(
      `gh api "repos/${repo}/contents/${path}?ref=${ref}" -H "Accept: application/vnd.github.raw"`,
    );
  } catch {
    // A package.json the pull request adds or removes has no other side.
    return undefined;
  }
};

const dependenciesAt = (repo: string, file: string, ref: string): unknown => {
  const content = contentAt(repo, file, ref);
  if (content === undefined) return undefined;
  try {
    return parseJson<unknown>(content);
  } catch {
    return fail(`${file} at ${ref} is not valid JSON.`);
  }
};

/** The dependency maps of every package.json the pull request changes. */
const dependencyChanges = (
  repo: string,
  files: readonly string[],
  mergeBase: string,
  headSha: string,
): DependencyChange[] =>
  files
    .filter((file) => file.endsWith("package.json"))
    .flatMap((file) => {
      const before = dependenciesAt(repo, file, mergeBase);
      const after = dependenciesAt(repo, file, headSha);
      if (before === undefined || after === undefined) return [];
      return [{ file, before: dependencyMap(before), after: dependencyMap(after) }];
    });

const writeTemp = (name: string, content: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-merge-")), name);
  writeFileSync(file, `${content}\n`);
  return file;
};

const main = (): void => {
  const repo = required("GH_REPO");
  const pr = required("PR_NUMBER");
  if (!/^\d+$/u.test(pr)) fail(`PR_NUMBER must be a pull request number, got '${pr}'.`);
  const dryRun = process.env["DRY_RUN"] === "1";

  const pull = pullOf(repo, pr);
  if (pull.state !== "OPEN") {
    console.log(`Pull request #${pr} is ${pull.state}; nothing to merge.`);
    return;
  }
  if (!isFactoryPull(pull.headRefName, pull.labels)) {
    console.log(`Pull request #${pr} is not a factory branch or label; leaving it alone.`);
    return;
  }

  const files = changedFiles(repo, pr);
  const base = compareOf(repo, pull.headRefOid);
  const facts: MergeFacts = {
    headSha: pull.headRefOid,
    headCommittedAt: pull.headCommittedAt,
    labels: pull.labels,
    ciRuns: ciRuns(repo, pull.headRefName),
    comments: issueComments(repo, pr),
    files,
    dependencyChanges: dependencyChanges(repo, files, base.mergeBase, pull.headRefOid),
    mergeState: pull.mergeStateStatus.toLowerCase(),
    mainAheadBy: base.mainAheadBy,
    mainFiles: base.files,
  };

  const step = mergeStep(facts);
  if (step.kind === "wait") {
    console.log(`Waiting: ${step.reason}`);
    return;
  }
  if (step.kind === "requeue-review") {
    console.log("The head moved after the review: queueing it for a new one.");
    if (!dryRun) sh(`gh pr edit ${pr} --repo "${repo}" --add-label "agent:review"`);
    return;
  }
  if (step.kind === "fix") {
    console.log(`Dispatching the fix loop: ${step.reason}.`);
    if (!dryRun) {
      sh(`gh workflow run factory-fix.yml -f pr=${pr} -f reason=${step.reason}`);
    }
    return;
  }
  if (step.kind === "escalate") {
    console.log(`Handing to a human:\n${step.reasons.map((reason) => `- ${reason}`).join("\n")}`);
    if (dryRun) return;
    const body = [
      "<!-- factory-merge -->",
      "## Factory merge: waiting for a human",
      "",
      "The merge gate will not auto-merge this pull request:",
      "",
      ...step.reasons.map((reason) => `- ${reason}`),
      "",
    ].join("\n");
    sh(`gh pr comment ${pr} --repo "${repo}" --body-file "${writeTemp("merge-comment.md", body)}"`);
    sh(`gh pr edit ${pr} --repo "${repo}" --add-label "ready-for-human"`);
    return;
  }

  const issue = pull.closing[0] ?? closingIssue(pull.body);
  if (issue === undefined) {
    // A factory pull request always closes its ticket; without one the merge
    // subject cannot name it.
    fail(`Pull request #${pr} closes no issue; cannot name the merge commit.`);
  }
  const subject = `chore(merge): #${String(issue)} ${pull.title}`;
  console.log(`Merging #${pr} as "${subject}".`);
  if (dryRun) return;
  sh(`gh pr merge ${pr} --repo "${repo}" --merge --subject ${shellArg(subject)}`);
  const commit = sh(
    `gh pr view ${pr} --repo "${repo}" --json mergeCommit --jq '.mergeCommit.oid'`,
  ).trim();
  if (commit === "" || commit === "null") {
    fail(`Pull request #${pr} merged but reported no merge commit.`);
  }
  sh(
    `gh issue comment ${String(issue)} --repo "${repo}" --body-file "${writeTemp("merge-done.md", `Merged in ${commit}.`)}"`,
  );
  try {
    sh(`gh issue close ${String(issue)} --repo "${repo}"`);
  } catch {
    // The pull request's `Closes #…` already closed it on merge.
  }
  console.log(`Merged in ${commit}. The push to main starts the dispatcher itself.`);
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
