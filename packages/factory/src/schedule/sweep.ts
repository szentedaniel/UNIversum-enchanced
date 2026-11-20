/**
 * The stuck-pull-request sweep: every heartbeat tick looks for open factory
 * pull requests that GitHub left with no CI run, no review or no merge
 * decision, nudges each one and hands a pull request a nudge did not help to a
 * person.
 *
 * One nudge per head commit: the action leaves a hidden marker comment
 * (`<!-- factory-sweep:<action>:<sha> -->`), so the same commit is never
 * nudged twice. A marker older than the grace period that still has not
 * produced a run means the nudge did not help: the pull request gets
 * `ready-for-human` and one comment saying what the sweep tried.
 *
 * The decisions here are pure and the test feeds them a fake clock and page of
 * runs. `schedule/tick.ts` calls the sweep after the nightly jobs and the
 * dispatcher, so a failed sweep cannot hold either back.
 *
 * The reads are one open-pull list, one page of the newest workflow runs
 * (`SWEEP_RUN_PAGE`) and one detail read per open factory pull request; a
 * nudge then costs one comment and one write, so a tick's API use is one list
 * call plus at most one call per open factory pull request. The grace is
 * GitHub's own ten-minute cron latency with room for a slow queue, and the
 * page is the newest 100 runs: a trigger older than that is a pull request a
 * later tick still nudges, once per head commit.
 */
import { isFactoryPull, reviewState } from "#merge/gates.ts";
import { newestMarkerComment, type ReviewComment } from "#review/summary.ts";
import { LIVE_STATUSES, messageOf } from "#schedule/heartbeat.ts";
import { GH_CALL_TIMEOUT_MS, sh, shellArg } from "#shared/common.ts";
import { isConflict, parseJson } from "#shared/github.ts";

/** How long a pull request may sit without the next step before the sweep nudges. */
export const SWEEP_GRACE_MS = 30 * 60 * 1000;

/** How much of the runs API one tick reads; the newest page is where a trigger is. */
export const SWEEP_RUN_PAGE = 100;

/** The three workflows the sweep reads. */
export const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
export const REVIEW_WORKFLOW_PATH = ".github/workflows/factory-review.yml";
export const MERGE_WORKFLOW_PATH = ".github/workflows/factory-merge.yml";

const SWEEP_PATHS: ReadonlySet<string> = new Set([
  CI_WORKFLOW_PATH,
  REVIEW_WORKFLOW_PATH,
  MERGE_WORKFLOW_PATH,
]);

/** The three actions a sweep can take; the action is also the marker's kind. */
export const SWEEP_ACTIONS = ["ci", "review", "merge"] as const;

export type SweepAction = (typeof SWEEP_ACTIONS)[number];

/** The hidden marker a nudge leaves, so this head commit is never nudged twice. */
export const sweepMarker = (action: SweepAction, sha: string): string =>
  `<!-- factory-sweep:${action}:${sha} -->`;

/** The marker an escalation leaves, so its comment is posted once. */
export const sweepEscalatedMarker = (action: SweepAction, sha: string): string =>
  `<!-- factory-sweep:${action}:${sha}:escalated -->`;

/** One workflow run as the runs page lists it. */
export interface SweepRun {
  /** `.github/workflows/<file>`, the field the runs API reports. */
  readonly path: string;
  readonly headSha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly createdAt: string;
  /** When the run last changed: a completed run's finishing time. */
  readonly updatedAt: string;
  /** The run's name; a factory run names the pull request as `#<n>`. */
  readonly displayTitle: string;
}

/** One pull request as the sweep's pull list reports it. */
export interface SweepPull {
  readonly number: number;
  readonly state: string;
  readonly headRefName: string;
  readonly headSha: string;
  readonly author: string;
  readonly createdAt: string;
  readonly headCommittedAt: string;
  readonly labels: readonly string[];
  readonly comments: readonly ReviewComment[];
}

export interface SweepFacts {
  readonly now: Date;
  readonly pull: SweepPull;
  /** The tick's runs page; the decision filters it to this pull request. */
  readonly runs: readonly SweepRun[];
}

export type SweepStep =
  | { readonly kind: "leave"; readonly reason: string }
  | { readonly kind: "nudge"; readonly action: SweepAction }
  | { readonly kind: "escalate"; readonly action: SweepAction };

const leave = (reason: string): SweepStep => ({ kind: "leave", reason });

/** A time the API sent, as milliseconds; an unreadable field counts as very old. */
const timeOf = (value: string): number => {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
};

/** Whether `SWEEP_GRACE_MS` passed since `since`; never before it is known. */
const waited = (now: Date, since: number): boolean =>
  since > 0 && now.getTime() - since >= SWEEP_GRACE_MS;

/** The runs of `path` whose name names this pull request. */
const pullRuns = (runs: readonly SweepRun[], path: string, number: number): SweepRun[] => {
  const named = new RegExp(`#${String(number)}(?!\\d)`, "u");
  return runs.filter((run) => run.path === path && named.test(run.displayTitle));
};

/** The newest CI run of the head commit; a re-run that passed wins over the failure before it. */
const newestCi = (runs: readonly SweepRun[], headSha: string): SweepRun | undefined =>
  runs
    .filter((run) => run.path === CI_WORKFLOW_PATH && run.headSha === headSha)
    .toSorted((a, b) => timeOf(a.createdAt) - timeOf(b.createdAt))
    .at(-1);

const isLive = (run: SweepRun): boolean => LIVE_STATUSES.some((status) => status === run.status);

/**
 * What an earlier nudge on this head commit means now: nothing, a wait for the
 * run it started, or a person when the run never came.
 */
const afterNudge = (action: SweepAction, pull: SweepPull, now: Date): SweepStep | undefined => {
  if (
    pull.comments.some((comment) =>
      comment.body.includes(sweepEscalatedMarker(action, pull.headSha)),
    )
  ) {
    return leave(`a person already has the ${action} nudge`);
  }
  const marker = pull.comments.find((comment) =>
    comment.body.includes(sweepMarker(action, pull.headSha)),
  );
  if (marker === undefined) return undefined;
  return waited(now, timeOf(marker.createdAt))
    ? { kind: "escalate", action }
    : leave(`the ${action} nudge is waiting for its run`);
};

/**
 * What the sweep does with one pull request: leave it alone, nudge it once, or
 * hand it to a person. The first case that fits wins, so a nudge never
 * duplicates a run that is already on its way.
 */
export const sweepStep = ({ now, pull, runs }: SweepFacts): SweepStep => {
  if (pull.state.toLowerCase() !== "open") {
    return leave(`the pull request is ${pull.state.toLowerCase()}`);
  }
  if (!isFactoryPull(pull.headRefName, pull.labels, pull.author)) {
    return leave("it is not a factory pull request");
  }
  if (pull.labels.includes("ready-for-human")) return leave("a person owns it (ready-for-human)");
  if (pull.labels.includes("agent:blocked")) return leave("it is blocked (agent:blocked)");

  const ci = newestCi(runs, pull.headSha);
  if (ci === undefined) {
    // GitHub sometimes starts no run at all on a new pull request: merging main
    // in pushes a commit, and the push event starts CI.
    const youngest = Math.max(timeOf(pull.createdAt), timeOf(pull.headCommittedAt));
    if (!waited(now, youngest)) return leave("the pull request is younger than 30 minutes");
    return afterNudge("ci", pull, now) ?? { kind: "nudge", action: "ci" };
  }

  if (ci.status !== "completed") return leave("CI is still running");
  if (ci.conclusion !== "success") return leave(`CI ${ci.conclusion ?? "did not finish"}`);
  const greenAt = timeOf(ci.updatedAt) || timeOf(ci.createdAt);

  if (pull.labels.includes("agent:review")) {
    if (!waited(now, greenAt)) return leave("CI went green less than 30 minutes ago");
    const reviews = pullRuns(runs, REVIEW_WORKFLOW_PATH, pull.number);
    // A run before the green CI was the label event's; it still counts as a
    // review on its way, while a run after it means the dispatch already landed.
    const posted = newestMarkerComment(pull.comments);
    const reviewed =
      posted !== undefined && timeOf(posted.createdAt) >= timeOf(pull.headCommittedAt);
    if (
      reviews.some(isLive) ||
      reviews.some((run) => timeOf(run.createdAt) >= greenAt) ||
      reviewed
    ) {
      return leave("a review is on its way");
    }
    return afterNudge("review", pull, now) ?? { kind: "nudge", action: "review" };
  }

  const review = reviewState({
    comments: pull.comments,
    headCommittedAt: pull.headCommittedAt,
  });
  if (review !== "pass") return leave(`the review is ${review}`);
  const posted = newestMarkerComment(pull.comments);
  if (posted === undefined) return leave("the review is not posted");
  const reviewed = timeOf(posted.createdAt);
  if (!waited(now, Math.max(reviewed, greenAt))) {
    return leave("the review passed less than 30 minutes ago");
  }
  if (
    pullRuns(runs, MERGE_WORKFLOW_PATH, pull.number).some(
      (run) => timeOf(run.createdAt) >= reviewed,
    )
  ) {
    return leave("the merge gate already ran since the review");
  }
  return afterNudge("merge", pull, now) ?? { kind: "nudge", action: "merge" };
};

/** What each nudge does, for the dry run and the log. */
const ACTION_TEXT: Readonly<Record<SweepAction, string>> = {
  ci: "merge main in and start CI",
  review: "dispatch factory-review.yml",
  merge: "dispatch factory-merge.yml",
};

/** Why each nudge is taken, in the comment it leaves on the pull request. */
const NUDGE_TEXT: Readonly<Record<SweepAction, string>> = {
  ci: "no CI run started on the head; merging `main` in to start one",
  review: "CI is green and `agent:review` is waiting; dispatching a review",
  merge: "CI is green and the review passed; dispatching the merge gate",
};

/** What each escalation tried, in the comment a person reads. */
const TRIED_TEXT: Readonly<Record<SweepAction, string>> = {
  ci: "merged `main` into the branch to start CI (a conflicting merge goes to the fix loop)",
  review: "dispatched `factory-review.yml` because CI is green and `agent:review` was waiting",
  merge: "dispatched `factory-merge.yml` because CI is green and the review passed",
};

/** The hidden marker a nudge leaves, and the one line that explains it. */
const nudgeComment = (action: SweepAction, sha: string): string =>
  [sweepMarker(action, sha), `Factory sweep: ${NUDGE_TEXT[action]}.`].join("\n");

/** The comment and marker an escalation leaves before the label goes on. */
const escalationComment = (action: SweepAction, pull: SweepPull): string =>
  [
    sweepEscalatedMarker(action, pull.headSha),
    `Factory sweep: ${TRIED_TEXT[action]} on \`${pull.headRefName}\`, but no run started within 30 minutes. A person needs to look at this pull request.`,
  ].join("\n");

export interface SweepDeps {
  readonly now: Date;
  readonly dryRun: boolean;
  /** Every open pull request. */
  readonly pulls: () => readonly SweepPull[];
  /** The tick's one page of workflow runs. */
  readonly runs: () => readonly SweepRun[];
  /** Merges `main` into the branch: `conflict` means the fix loop must resolve it. */
  readonly push: (pull: SweepPull) => "pushed" | "unchanged" | "conflict";
  readonly dispatch: (workflow: string, inputs: Readonly<Record<string, string>>) => void;
  readonly comment: (pr: number, body: string) => void;
  readonly label: (pr: number, name: string) => void;
  readonly log: (line: string) => void;
}

/**
 * One sweep: decide each open pull request and act, collecting a failure per
 * pull request so one refused write cannot stop the others.
 */
export const runSweep = ({
  now,
  dryRun,
  pulls,
  runs,
  push,
  dispatch,
  comment,
  label,
  log,
}: SweepDeps): readonly string[] => {
  const errors: string[] = [];
  const page = runs();

  for (const pull of pulls()) {
    try {
      const step = sweepStep({ now, pull, runs: page });
      if (step.kind === "leave") continue;
      if (dryRun) {
        log(
          step.kind === "nudge"
            ? `Dry run: would ${ACTION_TEXT[step.action]} for #${String(pull.number)} (${step.action}).`
            : `Dry run: would hand #${String(pull.number)} to a person (${step.action}).`,
        );
        continue;
      }
      if (step.kind === "escalate") {
        // The label is the dedupe: the next tick leaves a pull request a person owns.
        label(pull.number, "ready-for-human");
        comment(pull.number, escalationComment(step.action, pull));
        log(`Handed #${String(pull.number)} to a person: the ${step.action} nudge did not help.`);
        continue;
      }
      // The marker goes first: a refused dispatch must not repeat the nudge.
      comment(pull.number, nudgeComment(step.action, pull.headSha));
      if (step.action === "ci") {
        const pushed = push(pull);
        if (pushed === "conflict") {
          dispatch("factory-fix.yml", { pr: String(pull.number), reason: "main-moved" });
          log(`Merging main into #${String(pull.number)} conflicts; the fix loop decides.`);
        } else if (pushed === "unchanged") {
          log(`Main is already in #${String(pull.number)}; nothing to push.`);
        } else {
          log(`Merged main into #${String(pull.number)} to start CI.`);
        }
        continue;
      }
      const workflow = step.action === "review" ? "factory-review.yml" : "factory-merge.yml";
      dispatch(workflow, { pr: String(pull.number) });
      log(`Nudged #${String(pull.number)}: ${ACTION_TEXT[step.action]}.`);
    } catch (error) {
      errors.push(`#${String(pull.number)}: ${messageOf(error)}`);
    }
  }

  return errors;
};

/** A pull request as `gh pr list` reports it: the fields the factory filter needs. */
interface ApiPull {
  readonly number: number;
  readonly state: string;
  readonly headRefName: string;
  readonly headRefOid: string;
  readonly author: { readonly login: string } | null;
  readonly createdAt: string;
  readonly labels: readonly { readonly name: string }[];
}

/** The rest of one pull request: its comments and its commits. */
interface ApiPullDetail {
  readonly comments: readonly { readonly body: string; readonly createdAt: string }[];
  readonly commits: readonly { readonly committedDate: string }[];
}

/** A run as the runs API reports it. */
interface ApiRun {
  readonly path: string;
  readonly head_sha: string;
  readonly status: string;
  readonly conclusion: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly display_title?: string;
}

/** The pull requests a person owns; the sweep leaves them without reading further. */
const HELD_LABELS: readonly string[] = ["ready-for-human", "agent:blocked"];

/** One pull request's comments and commits; the detail read costs a call. */
const pullDetail = (repo: string, number: number): ApiPullDetail =>
  parseJson<ApiPullDetail>(
    sh(`gh pr view ${String(number)} --repo "${repo}" --json comments,commits`, GH_CALL_TIMEOUT_MS),
  );

/**
 * Every open factory pull request that the sweep may act on: one list call,
 * then one detail read per pull request that is neither a human's, blocked nor
 * already waiting for a person. The detail read carries the comments the
 * markers live in and the head commit's time.
 */
const openPulls = (repo: string): SweepPull[] => {
  const listed = parseJson<ApiPull[]>(
    sh(
      `gh pr list --repo "${repo}" --state open --limit 100 --json number,state,headRefName,headRefOid,author,createdAt,labels`,
      GH_CALL_TIMEOUT_MS,
    ),
  );
  const pulls: SweepPull[] = [];
  for (const pull of listed) {
    const labels = pull.labels.map((label) => label.name);
    if (!isFactoryPull(pull.headRefName, labels, pull.author?.login ?? "")) continue;
    if (HELD_LABELS.some((held) => labels.includes(held))) continue;
    const detail = pullDetail(repo, pull.number);
    pulls.push({
      number: pull.number,
      state: pull.state.toLowerCase(),
      headRefName: pull.headRefName,
      headSha: pull.headRefOid,
      author: pull.author?.login ?? "",
      createdAt: pull.createdAt,
      headCommittedAt: detail.commits.at(-1)?.committedDate ?? pull.createdAt,
      labels,
      comments: detail.comments.map((comment) => ({
        body: comment.body,
        createdAt: comment.createdAt,
      })),
    });
  }
  return pulls;
};

/** The newest page of workflow runs; the sweep only reads its three workflows. */
const recentRuns = (repo: string): SweepRun[] =>
  parseJson<ApiRun[]>(
    sh(
      `gh api "repos/${repo}/actions/runs?per_page=${String(SWEEP_RUN_PAGE)}" --jq '.workflow_runs'`,
      GH_CALL_TIMEOUT_MS,
    ),
  )
    .filter((run) => SWEEP_PATHS.has(run.path))
    .map((run) => ({
      path: run.path,
      headSha: run.head_sha,
      status: run.status,
      conclusion: run.conclusion,
      createdAt: run.created_at,
      updatedAt: run.updated_at,
      displayTitle: run.display_title ?? "",
    }));

/** The status line `gh api --include` prints before the body. */
const STATUS_LINE = /^HTTP\/[\d.]+ (\d{3})/u;

/**
 * Merges `main` into the branch through the API: GitHub writes the merge
 * commit and pushes it as the PAT, so the push event starts CI. A conflict is
 * the fix loop's; anything else is a failure the tick reports. The message is
 * the fix loop's conventional one: GitHub's default `Merge main into …` fails
 * the branch's commit check.
 */
const pushMain = (repo: string, branch: string): "pushed" | "unchanged" | "conflict" => {
  try {
    const message = `chore: merge main into ${branch}`;
    const response = sh(
      `gh api --include --method POST "repos/${repo}/merges" -f base=${shellArg(branch)} -f head=main -f commit_message=${shellArg(message)}`,
      GH_CALL_TIMEOUT_MS,
    );
    return STATUS_LINE.exec(response)?.[1] === "204" ? "unchanged" : "pushed";
  } catch (error) {
    if (isConflict(error)) return "conflict";
    throw error;
  }
};

/** The sweep's real `gh` wiring: the two reads, the merge and the writes a nudge needs. */
export const sweepWiring = (
  repo: string,
): Pick<SweepDeps, "pulls" | "runs" | "push" | "dispatch" | "comment" | "label"> => ({
  pulls: () => openPulls(repo),
  runs: () => recentRuns(repo),
  push: (pull) => pushMain(repo, pull.headRefName),
  dispatch: (workflow, inputs) => {
    const flags = Object.entries(inputs)
      .map(([name, value]) => ` -f ${name}=${shellArg(value)}`)
      .join("");
    sh(`gh workflow run ${workflow} --ref main${flags}`, GH_CALL_TIMEOUT_MS);
  },
  comment: (pr, body) => {
    sh(`gh pr comment ${String(pr)} --repo "${repo}" --body ${shellArg(body)}`, GH_CALL_TIMEOUT_MS);
  },
  label: (pr, name) => {
    sh(
      `gh pr edit ${String(pr)} --repo "${repo}" --add-label ${shellArg(name)}`,
      GH_CALL_TIMEOUT_MS,
    );
  },
});
