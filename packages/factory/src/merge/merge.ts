/**
 * The factory's merge gate: `mergeGate` reads the pull request and leaves a
 * closed, fork or human pull alone before `readMergeFacts` reads anything
 * else; `mergeStep` decides, and `performStep` merges it, waits for a run
 * still in flight, queues the re-review a push needs, sends the fix loop after
 * main, or hands the reasons to the owner. A `gh` read GitHub refuses for a
 * rate limit is waited out and retried; a refusal the run's budget cannot
 * outlast, and any refused write, exits green without an escalation, for a
 * later run to decide. `DRY_RUN=1` prints what it would do and writes nothing.
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
import {
  apiBody,
  isNotFound,
  isRateLimit,
  issueComments,
  parseJson,
  RateLimitExhausted,
  retryOnRateLimit,
  type RetryOptions,
} from "#shared/github.ts";

const PULL_FIELDS =
  "number,state,title,body,headRefName,headRefOid,mergeStateStatus,labels,closingIssuesReferences,commits,author";

const readPull = (repo: string, pr: string): PullView => {
  const raw = sh(
    `gh pr view ${pr} --repo "${repo}" --json ${PULL_FIELDS} --jq '{number, state, title, body, headRefName, headRefOid, mergeStateStatus: (.mergeStateStatus // "unknown"), labels: [.labels[].name], closing: [.closingIssuesReferences[].number], headCommittedAt: (.commits | last | .committedDate // ""), author: (.author.login // "")}'`,
  );
  return parseJson<PullView>(raw);
};

/** GitHub answers `UNKNOWN` for a few reads after main moves. */
const MERGEABILITY_READS = 6;

/** GitHub computes mergeability lazily: the first read after main moves says
 * UNKNOWN. Deciding on that once merged a conflicting pull request, so the
 * read waits for an answer, about half a minute at most. The pause is a seam
 * so the retry is testable without sleeping.
 */
export const waitForMergeability = (
  read: () => PullView,
  pause: () => void = () => sh("sleep 5"),
): PullView => {
  for (let attempt = 1; ; attempt++) {
    const pull = read();
    if (pull.mergeStateStatus.toLowerCase() !== "unknown" || attempt === MERGEABILITY_READS) {
      return pull;
    }
    pause();
  }
};

/** Every file the pull request changes, as the files API sees them. */
const changedFiles = (repo: string, pr: string): string[] =>
  apiBody(
    sh(`gh api -i "repos/${repo}/pulls/${pr}/files?per_page=100" --paginate --jq '.[].filename'`),
  )
    .split("\n")
    .filter((line) => line !== "");

/** The CI runs on the pull request's branch; the gate picks the head's newest. */
const ciRuns = (repo: string, branch: string): CiRun[] =>
  parseJson<CiRun[]>(
    apiBody(
      sh(
        `gh api -i "repos/${repo}/actions/workflows/ci.yml/runs?branch=${encodeURIComponent(branch)}&per_page=50" --jq '[.workflow_runs[] | {headSha: .head_sha, status: .status, conclusion: .conclusion, createdAt: .created_at}]'`,
      ),
    ),
  );

/** What main holds that the head does not: its files and how many commits. */
const compareOf = (repo: string, headSha: string): CompareView =>
  parseJson<CompareView>(
    apiBody(
      sh(
        `gh api -i "repos/${repo}/compare/${headSha}...main" --jq '{mergeBase: .merge_base_commit.sha, mainAheadBy: .ahead_by, files: [.files[].filename]}'`,
      ),
    ),
  );

/** A file's content at a ref, or `undefined` when it does not exist there. */
const contentAt = (repo: string, path: string, ref: string): string | undefined => {
  try {
    return apiBody(
      sh(
        `gh api -i "repos/${repo}/contents/${path}?ref=${ref}" -H "Accept: application/vnd.github.raw"`,
      ),
    );
  } catch (error) {
    // A package.json the pull request adds or removes has no other side; a
    // rate limit must reach the retry rather than read as a missing file.
    if (!isNotFound(error)) throw error;
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
  pullOf: (repo, pr) => waitForMergeability(() => readPull(repo, pr)),
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

/** "decided": the step ran through; "rate-limited": GitHub refused every attempt, so a later run must. */
export type MergeGateOutcome = "decided" | "rate-limited";

/**
 * The gate's flow for one pull request: the pull read and the open/factory
 * guard first, because a pull request the gate leaves alone must not cost
 * further reads (a closed pull's CI, a fork's files, a human's compare).
 *
 * Every read the two seams make retries a rate-limit refusal, waiting from one
 * budget the whole run shares. A write is never retried: a refusal there did
 * not apply, and a retried non-idempotent write (a merge, a second comment)
 * can leave half a finished state behind. A run that cannot finish exits green
 * and leaves the pull request for a later run, rather than telling the owner
 * the gate could not decide a transient refusal.
 */
export const mergeGate = (
  repo: string,
  pr: string,
  reader: MergeReader,
  actions: MergeActions,
  dryRun: boolean,
  retry: RetryOptions = {},
): MergeGateOutcome => {
  const options: RetryOptions = { ...retry, budget: retry.budget ?? { spentMs: 0 } };
  // The retry loop lives in the gh seam; the gate binds it once and wraps only
  // the reads, so no caller grows its own loop and no write is ever retried.
  const retryRead = <T>(run: () => T): T => retryOnRateLimit(run, options);
  const reads: MergeReader = {
    pullOf: (repository, pull) => retryRead(() => reader.pullOf(repository, pull)),
    changedFiles: (repository, pull) => retryRead(() => reader.changedFiles(repository, pull)),
    ciRuns: (repository, branch) => retryRead(() => reader.ciRuns(repository, branch)),
    compareOf: (repository, headSha) => retryRead(() => reader.compareOf(repository, headSha)),
    contentAt: (repository, path, ref) => retryRead(() => reader.contentAt(repository, path, ref)),
    issueComments: (repository, pull) => retryRead(() => reader.issueComments(repository, pull)),
  };
  // `ticketTitle` is the one read on the actions seam; every write stays bare.
  const writes: MergeActions = {
    ...actions,
    ticketTitle: (issue) => retryRead(() => actions.ticketTitle(issue)),
  };

  try {
    const pull = reads.pullOf(repo, pr);
    if (pull.state !== "OPEN") {
      console.log(`Pull request #${pr} is ${pull.state}; nothing to merge.`);
      return "decided";
    }
    if (!isFactoryPull(pull.headRefName, pull.labels, pull.author)) {
      console.log(`Pull request #${pr} is not a factory branch or label; leaving it alone.`);
      return "decided";
    }

    performStep(mergeStep(readMergeFacts(repo, pr, pull, reads)), pull, {
      actions: writes,
      dryRun,
    });
    return "decided";
  } catch (error) {
    if (!(error instanceof RateLimitExhausted) && !isRateLimit(error)) throw error;
    console.log(`::warning::${error instanceof Error ? error.message : String(error)}`);
    return "rate-limited";
  }
};

const main = (): void => {
  const repo = required("GH_REPO");
  const pr = required("PR_NUMBER");
  if (!/^\d+$/u.test(pr)) fail(`PR_NUMBER must be a pull request number, got '${pr}'.`);
  const dryRun = process.env["DRY_RUN"] === "1";

  mergeGate(repo, pr, ghReader, ghActions(repo, pr), dryRun);
};

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
