/**
 * The nightly retro's facts: the last 24 hours of the factory's own trail,
 * shaped into the one JSON the prompt reads. The `gh` reads live at the
 * bottom; everything above them is pure, so the fixture tests pin the shaping.
 *
 * Facts: the factory pull requests the window saw (merged or blocked), their
 * review summaries, fix rounds, escalations, and the fixes the reviewer
 * committed; red `CI` runs with their failed jobs; and every comment the owner
 * wrote on a factory issue or pull request. The pull request's own comments
 * carry the owner's, the factory's and other people's words, so the owner's
 * are the ones with no factory sign — the PAT is the owner's account.
 *
 * Env: GH_REPO, GH_TOKEN (the PAT, in the workflow), OUTPUT_DIR, DRY_RUN
 * (prints the facts to stderr). It writes `OUTPUT_DIR/facts.json` and prints
 * `true` or `false`: whether the day had any factory activity at all.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ESCALATED_MARKER, fixRoundOf } from "#fix/rounds.ts";
import { MERGE_ESCALATED_MARKER } from "#merge/comment.ts";
import { isFactoryPull } from "#merge/gates.ts";
import { reviewVerdictOf, type ReviewVerdict } from "#review/summary.ts";
import { REVIEW_MARKER } from "#review/window.ts";
import { fail, outputDir, required, sh } from "#shared/common.ts";
import { jsonLines, parseJson } from "#shared/github.ts";

/** The window: the last day, as the ticket's "nightly" means it. */
export const WINDOW_HOURS = 24;

/** The git identity every factory workflow commits with (`git config` there). */
export const FACTORY_GIT_NAME = "universum-factory[bot]";
export const FACTORY_GIT_EMAIL = "universum-factory[bot]@users.noreply.github.com";

/** A comment body is evidence, not a document: this much of it is enough. */
const MAX_BODY_CHARS = 4000;
const MAX_OPEN_BODY_CHARS = 600;

/** The comment openings the factory's own workflows write without a marker. */
export const FACTORY_COMMENT_SIGNS = [
  "<!-- factory-",
  "The factory could not ",
  "The fix loop could not ",
  "Factory fix: ",
  "Merged in ",
  "STATUS: ",
] as const;

/**
 * Whether the factory wrote this comment. Every step's marker starts with
 * `<!-- factory-`; the rest are the prose the failure, merge and blocked
 * paths write without one. What is left, by the owner's account, is a person.
 */
export const isFactoryComment = (body: string): boolean => {
  const start = body.trimStart();
  return FACTORY_COMMENT_SIGNS.some((sign) => start.startsWith(sign));
};

/**
 * A factory issue carries the `factory` or `factory:report` label, or is a
 * spec (`spec:proposed` / `spec:approved`). The owner's comments on tickets
 * and game issues are product direction, not the factory's own trail.
 */
const FACTORY_ISSUE_LABEL = /^(factory$|factory:|spec:)/u;

/** The REST shapes the wrapper maps into `RawFacts`; the fixture is this shape. */
export interface RawPull {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly headRefName: string;
  readonly labels: readonly string[];
  readonly state: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly mergedAt: string | null;
  readonly url: string;
}

export interface RawComment {
  readonly body: string;
  readonly createdAt: string;
  readonly authorLogin: string;
  readonly issueNumber: number;
}

export interface RawCommit {
  readonly sha: string;
  readonly message: string;
  readonly authorName: string;
  readonly authorEmail: string;
  readonly committedAt: string;
  readonly parents: number;
}

export interface RawRun {
  readonly id: number;
  readonly conclusion: string;
  readonly createdAt: string;
  readonly headBranch: string;
  readonly displayTitle: string;
}

export interface RawIssue {
  readonly number: number;
  readonly title: string;
  readonly labels: readonly string[];
}

export interface RawOpenIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
}

export interface RawOpenPull {
  readonly number: number;
  readonly title: string;
}

export interface RawFacts {
  readonly owner: string;
  readonly pulls: readonly RawPull[];
  readonly comments: readonly RawComment[];
  readonly commits: Readonly<Record<string, readonly RawCommit[]>>;
  readonly runs: readonly RawRun[];
  readonly failedJobs: Readonly<Record<string, readonly string[]>>;
  readonly factoryIssues: readonly RawIssue[];
  readonly openIssues: readonly RawOpenIssue[];
  readonly openPulls: readonly RawOpenPull[];
}

/** A comment that carried a factory marker, kept for the prompt's evidence. */
export interface MarkerComment {
  readonly body: string;
  readonly createdAt: string;
}

export interface ReviewFact extends MarkerComment {
  /** `null` when the marker is there but the verdict line is not. */
  readonly verdict: ReviewVerdict | null;
}

export interface FixRoundFact extends MarkerComment {
  readonly round: number;
}

export interface CommitFact {
  readonly sha: string;
  readonly message: string;
  readonly committedAt: string;
}

export interface PullFact {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly branch: string;
  readonly state: "OPEN" | "CLOSED" | "MERGED";
  readonly labels: readonly string[];
  readonly createdAt: string;
  readonly mergedAt: string | null;
  readonly reviews: readonly ReviewFact[];
  readonly fixRounds: readonly FixRoundFact[];
  readonly escalations: readonly MarkerComment[];
  readonly mergeEscalations: readonly MarkerComment[];
  /** The fixes the reviewer committed before each review summary. */
  readonly reviewerCommits: readonly CommitFact[];
}

export interface CiFailureFact {
  readonly id: number;
  readonly branch: string;
  readonly title: string;
  readonly createdAt: string;
  readonly failedJobs: readonly string[];
}

export interface OwnerCommentFact {
  readonly issue: number;
  readonly title: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface RetroWindow {
  readonly since: string;
  readonly until: string;
}

export interface RetroFacts {
  readonly window: RetroWindow;
  readonly pulls: readonly PullFact[];
  readonly ciFailures: readonly CiFailureFact[];
  readonly ownerComments: readonly OwnerCommentFact[];
  readonly openIssues: readonly RawOpenIssue[];
  readonly openPulls: readonly RawOpenPull[];
}

const truncate = (text: string, limit: number): string =>
  text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;

const inWindow = (iso: string, since: Date, until: Date): boolean => {
  const at = Date.parse(iso);
  return Number.isFinite(at) && at >= since.getTime() && at <= until.getTime();
};

const isFactoryIssue = (labels: readonly string[]): boolean =>
  labels.some((label) => FACTORY_ISSUE_LABEL.test(label));

/**
 * The commits the reviewer made: the factory's git identity, committed after
 * the pull request opened (or after the last marker before the review) and no
 * later than the review summary that follows them. The implementer's first
 * push precedes the pull request's creation, and a fix round's commits precede
 * its marker, so neither interval contains them; git's own merges are skipped.
 */
const reviewerCommitsOf = (
  createdAt: string,
  comments: readonly RawComment[],
  commits: readonly RawCommit[],
): CommitFact[] => {
  const markers = comments
    .filter((comment) => comment.body.includes("<!-- factory-"))
    .map((comment) => ({
      at: Date.parse(comment.createdAt),
      review: comment.body.includes(REVIEW_MARKER),
    }))
    .filter((marker) => Number.isFinite(marker.at))
    .toSorted((a, b) => a.at - b.at);
  const selected = new Map<string, CommitFact>();
  for (const marker of markers.filter((candidate) => candidate.review)) {
    let lower = Date.parse(createdAt);
    for (const before of markers.filter((candidate) => candidate.at < marker.at)) {
      if (before.at > lower) lower = before.at;
    }
    for (const commit of commits) {
      const when = Date.parse(commit.committedAt);
      if (!Number.isFinite(when) || when <= lower || when > marker.at) continue;
      const factory =
        commit.authorName === FACTORY_GIT_NAME || commit.authorEmail === FACTORY_GIT_EMAIL;
      if (!factory || commit.parents > 1 || commit.message.startsWith("chore(merge):")) continue;
      selected.set(commit.sha, {
        sha: commit.sha,
        message: commit.message,
        committedAt: commit.committedAt,
      });
    }
  }
  return [...selected.values()].toSorted(
    (a, b) => Date.parse(a.committedAt) - Date.parse(b.committedAt),
  );
};

const byCreatedAt = (a: { createdAt: string }, b: { createdAt: string }): number =>
  Date.parse(a.createdAt) - Date.parse(b.createdAt);

const shapePull = (
  pull: RawPull,
  comments: readonly RawComment[],
  commits: readonly RawCommit[],
): PullFact => {
  const reviews = comments.flatMap((comment): ReviewFact[] => {
    if (!comment.body.includes(REVIEW_MARKER)) return [];
    return [
      {
        verdict: reviewVerdictOf(comment.body) ?? null,
        body: truncate(comment.body, MAX_BODY_CHARS),
        createdAt: comment.createdAt,
      },
    ];
  });
  const fixRounds = comments.flatMap((comment): FixRoundFact[] => {
    const round = fixRoundOf(comment.body);
    return round === undefined
      ? []
      : [{ round, body: truncate(comment.body, MAX_BODY_CHARS), createdAt: comment.createdAt }];
  });
  const markerComments = (marker: string): MarkerComment[] =>
    comments
      .filter((comment) => comment.body.includes(marker))
      .map((comment) => ({
        body: truncate(comment.body, MAX_BODY_CHARS),
        createdAt: comment.createdAt,
      }));
  return {
    number: pull.number,
    title: pull.title,
    url: pull.url,
    branch: pull.headRefName,
    state: pull.state === "MERGED" ? "MERGED" : pull.state === "CLOSED" ? "CLOSED" : "OPEN",
    labels: [...pull.labels],
    createdAt: pull.createdAt,
    mergedAt: pull.mergedAt,
    reviews: reviews.toSorted(byCreatedAt),
    fixRounds: fixRounds.toSorted(byCreatedAt),
    escalations: markerComments(ESCALATED_MARKER).toSorted(byCreatedAt),
    mergeEscalations: markerComments(MERGE_ESCALATED_MARKER).toSorted(byCreatedAt),
    reviewerCommits: reviewerCommitsOf(pull.createdAt, comments, commits),
  };
};

/**
 * The window's facts. The wrapper feeds this the raw `gh` output; a fixture
 * feeds it the same shape, so the test pins the shaping, not the API.
 */
export const factsOf = (
  raw: RawFacts,
  window: { readonly since: Date; readonly until: Date },
): RetroFacts => {
  const visible = (iso: string): boolean => inWindow(iso, window.since, window.until);
  const pulls = raw.pulls
    .filter((pull) => isFactoryPull(pull.headRefName, pull.labels) && visible(pull.updatedAt))
    .map((pull) =>
      shapePull(
        pull,
        raw.comments.filter(
          (comment) => comment.issueNumber === pull.number && visible(comment.createdAt),
        ),
        raw.commits[String(pull.number)] ?? [],
      ),
    )
    .toSorted((a, b) => a.number - b.number);

  const factoryIssues = raw.factoryIssues.filter((issue) => isFactoryIssue(issue.labels));
  const titles = new Map<number, string>();
  for (const pull of raw.pulls) titles.set(pull.number, pull.title);
  for (const issue of factoryIssues) titles.set(issue.number, issue.title);
  const factoryTargets = new Set([
    ...pulls.map((pull) => pull.number),
    ...factoryIssues.map((issue) => issue.number),
  ]);

  const ownerComments = raw.comments
    .filter(
      (comment) =>
        visible(comment.createdAt) &&
        comment.authorLogin === raw.owner &&
        factoryTargets.has(comment.issueNumber) &&
        !isFactoryComment(comment.body),
    )
    .map((comment) => ({
      issue: comment.issueNumber,
      title: titles.get(comment.issueNumber) ?? "",
      body: truncate(comment.body, MAX_BODY_CHARS),
      createdAt: comment.createdAt,
    }))
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  const ciFailures = raw.runs
    .filter((run) => run.conclusion === "failure" && visible(run.createdAt))
    .map((run) => ({
      id: run.id,
      branch: run.headBranch,
      title: run.displayTitle,
      createdAt: run.createdAt,
      failedJobs: [...(raw.failedJobs[String(run.id)] ?? [])],
    }))
    .toSorted((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  return {
    window: { since: window.since.toISOString(), until: window.until.toISOString() },
    pulls,
    ciFailures,
    ownerComments,
    openIssues: raw.openIssues.map((issue) => ({
      number: issue.number,
      title: issue.title,
      body: truncate(issue.body, MAX_OPEN_BODY_CHARS),
    })),
    openPulls: raw.openPulls.map((pull) => ({ number: pull.number, title: pull.title })),
  };
};

/** Whether the day had anything to learn from: a skipped retro costs no Claude call. */
export const hasActivity = (facts: RetroFacts): boolean =>
  facts.pulls.length > 0 || facts.ciFailures.length > 0 || facts.ownerComments.length > 0;

/** The `gh` reads; every argument comes from the workflow's env or the repo. */
const fetchFacts = (repo: string, since: Date): RawFacts => {
  const owner = repo.split("/")[0] ?? "";
  const sinceIso = since.toISOString();
  const ghPulls = parseJson<
    {
      number: number;
      title: string;
      body: string;
      headRefName: string;
      labels: { name: string }[];
      state: string;
      createdAt: string;
      updatedAt: string;
      mergedAt: string | null;
      url: string;
    }[]
  >(
    sh(
      `gh pr list --repo "${repo}" --state all --limit 100 --json number,title,body,headRefName,labels,state,createdAt,updatedAt,mergedAt,url`,
    ),
  );
  const pulls: RawPull[] = ghPulls.map((pull) => ({
    number: pull.number,
    title: pull.title,
    body: pull.body,
    headRefName: pull.headRefName,
    labels: pull.labels.map((label) => label.name),
    state: pull.state,
    createdAt: pull.createdAt,
    updatedAt: pull.updatedAt,
    mergedAt: pull.mergedAt,
    url: pull.url,
  }));
  const windowPulls = pulls.filter(
    (pull) =>
      isFactoryPull(pull.headRefName, pull.labels) && Date.parse(pull.updatedAt) >= since.getTime(),
  );

  const commits: Record<string, readonly RawCommit[]> = {};
  for (const pull of windowPulls) {
    commits[String(pull.number)] = jsonLines<RawCommit>(
      sh(
        `gh api "repos/${repo}/pulls/${String(pull.number)}/commits?per_page=100" --paginate --jq '.[] | {sha: .sha, message: (.commit.message | split("\\n")[0]), authorName: .commit.author.name, authorEmail: .commit.author.email, committedAt: .commit.committer.date, parents: (.parents | length)}'`,
      ),
    );
  }

  const comments = jsonLines<RawComment>(
    sh(
      `gh api "repos/${repo}/issues/comments?since=${sinceIso}&per_page=100" --paginate --jq '.[] | {body: .body, createdAt: .created_at, authorLogin: .user.login, issueNumber: (.issue_url | split("/") | last | tonumber)}'`,
    ),
  );

  const factoryIssues = jsonLines<RawIssue>(
    sh(
      `gh api "repos/${repo}/issues?state=all&since=${sinceIso}&per_page=100" --paginate --jq '.[] | select(.pull_request == null) | {number, title, labels: [.labels[].name]}'`,
    ),
  );

  const ghRuns = parseJson<
    {
      databaseId: number;
      conclusion: string;
      createdAt: string;
      headBranch: string;
      displayTitle: string;
    }[]
  >(
    sh(
      `gh run list --repo "${repo}" --workflow ci.yml --limit 100 --json databaseId,conclusion,createdAt,headBranch,displayTitle`,
    ),
  );
  const runs: RawRun[] = ghRuns.map((run) => ({
    id: run.databaseId,
    conclusion: run.conclusion,
    createdAt: run.createdAt,
    headBranch: run.headBranch,
    displayTitle: run.displayTitle,
  }));

  const failedJobs: Record<string, readonly string[]> = {};
  for (const run of runs) {
    if (run.conclusion !== "failure" || Date.parse(run.createdAt) < since.getTime()) continue;
    failedJobs[String(run.id)] = parseJson<string[]>(
      sh(
        `gh api "repos/${repo}/actions/runs/${String(run.id)}/jobs?per_page=100" --jq '[.jobs[] | select(.conclusion == "failure") | .name]'`,
      ),
    );
  }

  return {
    owner,
    pulls,
    comments,
    commits,
    runs,
    failedJobs,
    factoryIssues,
    openIssues: parseJson<RawOpenIssue[]>(
      sh(`gh issue list --repo "${repo}" --state open --limit 200 --json number,title,body`),
    ),
    openPulls: parseJson<RawOpenPull[]>(
      sh(`gh pr list --repo "${repo}" --state open --limit 100 --json number,title`),
    ),
  };
};

const main = (): void => {
  const repo = required("GH_REPO");
  const until = new Date();
  const since = new Date(until.getTime() - WINDOW_HOURS * 60 * 60 * 1000);
  const facts = factsOf(fetchFacts(repo, since), { since, until });

  const output = outputDir();
  mkdirSync(output, { recursive: true });
  writeFileSync(join(output, "facts.json"), `${JSON.stringify(facts, null, 2)}\n`);

  const reviewerFixes = facts.pulls.reduce((sum, pull) => sum + pull.reviewerCommits.length, 0);
  console.error(
    `Retro facts: ${String(facts.pulls.length)} pull request(s), ${String(reviewerFixes)} reviewer fix(es), ` +
      `${String(facts.ciFailures.length)} red CI run(s), ${String(facts.ownerComments.length)} owner comment(s).`,
  );
  if (process.env["DRY_RUN"] === "1") console.error(JSON.stringify(facts, null, 2));
  console.log(hasActivity(facts) ? "true" : "false");
};

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}
