/**
 * The factory's merge gate: `readMergeFacts` reads one pull request's facts,
 * `mergeStep` decides, and `performStep` merges it, waits for a run still in
 * flight, queues the re-review a push needs, sends the fix loop after main, or
 * hands the reasons to the owner. `DRY_RUN=1` prints what it would do and
 * writes nothing.
 *
 * Env: PR_NUMBER, GH_REPO, GH_TOKEN (the PAT, in the workflow), DRY_RUN.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readMergeFacts, type CompareView, type MergeReader, type PullView } from "#merge/facts.ts";
import { isFactoryPull, mergeStep, type CiRun } from "#merge/gates.ts";
import { performStep, type MergeActions } from "#merge/perform.ts";
import { fail, required, sh, shellArg } from "#shared/common.ts";
import { issueComments, parseJson } from "#shared/github.ts";

const PULL_FIELDS =
  "number,state,title,body,headRefName,headRefOid,mergeStateStatus,labels,closingIssuesReferences,commits,author";

const readPull = (repo: string, pr: string): PullView => {
  const raw = sh(
    `gh pr view ${pr} --repo "${repo}" --json ${PULL_FIELDS} --jq '{number, state, title, body, headRefName, headRefOid, mergeStateStatus: (.mergeStateStatus // "unknown"), labels: [.labels[].name], closing: [.closingIssuesReferences[].number], headCommittedAt: (.commits | last | .committedDate // ""), author: (.author.login // "")}'`,
  );
  return parseJson<PullView>(raw);
};

/**
 * GitHub computes mergeability lazily: the first read after main moves says
 * UNKNOWN. Deciding on that once merged a conflicting pull request, so the
 * read waits for an answer, about half a minute at most.
 */
const pullOf = (repo: string, pr: string): PullView => {
  for (let attempt = 1; ; attempt++) {
    const pull = readPull(repo, pr);
    if (pull.mergeStateStatus.toLowerCase() !== "unknown" || attempt === 6) return pull;
    sh("sleep 5");
  }
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

const writeTemp = (name: string, content: string): string => {
  const file = join(mkdtempSync(join(tmpdir(), "factory-merge-")), name);
  writeFileSync(file, `${content}\n`);
  return file;
};

/** The gate's `gh` reads, as `readMergeFacts` consumes them. */
const ghReader: MergeReader = {
  pullOf,
  changedFiles,
  ciRuns,
  compareOf,
  contentAt,
  issueComments,
};

/** The gate's `gh` writes, bound to one pull request. */
const ghActions = (repo: string, pr: string): MergeActions => ({
  label: (name) => {
    sh(`gh pr edit ${pr} --repo "${repo}" --add-label ${shellArg(name)}`);
  },
  comment: (body) => {
    sh(`gh pr comment ${pr} --repo "${repo}" --body-file "${writeTemp("merge-comment.md", body)}"`);
  },
  dispatchFix: (reason) => {
    sh(`gh workflow run factory-fix.yml -f pr=${pr} -f reason=${reason}`);
  },
  merge: (subject) => {
    sh(`gh pr merge ${pr} --repo "${repo}" --merge --subject ${shellArg(subject)}`);
    return sh(
      `gh pr view ${pr} --repo "${repo}" --json mergeCommit --jq '.mergeCommit.oid'`,
    ).trim();
  },
  commentOnIssue: (issue, body) => {
    sh(
      `gh issue comment ${String(issue)} --repo "${repo}" --body-file "${writeTemp("merge-done.md", body)}"`,
    );
  },
  closeIssue: (issue) => {
    try {
      sh(`gh issue close ${String(issue)} --repo "${repo}"`);
    } catch {
      // The pull request's `Closes #…` already closed it on merge.
    }
  },
  ticketTitle: (issue) =>
    sh(`gh issue view ${String(issue)} --repo "${repo}" --json title --jq .title`),
});

const main = (): void => {
  const repo = required("GH_REPO");
  const pr = required("PR_NUMBER");
  if (!/^\d+$/u.test(pr)) fail(`PR_NUMBER must be a pull request number, got '${pr}'.`);
  const dryRun = process.env["DRY_RUN"] === "1";

  const { pull, facts } = readMergeFacts(repo, pr, ghReader);
  if (pull.state !== "OPEN") {
    console.log(`Pull request #${pr} is ${pull.state}; nothing to merge.`);
    return;
  }
  if (!isFactoryPull(pull.headRefName, pull.labels, pull.author)) {
    console.log(`Pull request #${pr} is not a factory branch or label; leaving it alone.`);
    return;
  }

  performStep(mergeStep(facts), pull, { actions: ghActions(repo, pr), dryRun });
};

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
